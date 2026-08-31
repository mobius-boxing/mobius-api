import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import {
  ICorrugation,
  ICorrugationLayer,
} from "../../interfaces/corrugation/corrugation.interfaces";
import { v4 as uuidv4 } from "uuid";
import {
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type ParsedQuery,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { applyCompanyUuidScope } from "../../utils/daoScope";
import { diffKeyedRows } from "../../utils/setDiff";
import { Request } from "express";

// companyId is handled separately via a join because the client sends a UUID, not a numeric id.
const CORRUGATION_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  description: {
    column: "description",
    operator: "ILIKE",
  },
  corrugationClassId: {
    column: "corrugationClassId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const CORRUGATION_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  theoreticalGrammage: { column: "theoreticalGrammage" },
  suggestedWidth: { column: "suggestedWidth" },
  caliper: { column: "caliper" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const CORRUGATION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "corrugations",
  {
    filters: CORRUGATION_FILTERS,
    sorting: CORRUGATION_SORTING,
    search: {
      columns: ["code", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "code",
      order: "asc",
    },
  },
);

/** A stored `corrugation_layers` row, as the layer diff reads it. */
type StoredLayer = {
  id: number;
  uuid: string;
  position: number;
  isLiner: boolean;
  paperClassId: number | null;
  fluteTypeId: number | null;
};

/** An incoming layer, already normalised to the stored column shape. */
type IncomingLayer = Omit<StoredLayer, "id" | "uuid"> & { uuid?: string };

/**
 * The columns a layer edit can touch, as an update patch; `{}` means the row is
 * untouched and gets no UPDATE. `id`, `uuid`, `corrugationId`, `legacyId` and
 * the timestamps are deliberately absent — identity, parentage and audit
 * columns are not user-editable, and `updatedAt` is set only alongside a real
 * change.
 */
function changedLayerColumns(
  incoming: IncomingLayer,
  stored: StoredLayer,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (incoming.position !== stored.position) {
    changes.position = incoming.position;
  }
  if (incoming.isLiner !== stored.isLiner) changes.isLiner = incoming.isLiner;
  if (incoming.paperClassId !== (stored.paperClassId ?? null)) {
    changes.paperClassId = incoming.paperClassId;
  }
  if (incoming.fluteTypeId !== (stored.fluteTypeId ?? null)) {
    changes.fluteTypeId = incoming.fluteTypeId;
  }
  return changes;
}

export class CorrugationDAO implements IBaseDAO<ICorrugation> {
  private tableName = "corrugations";
  private queryConfig = CORRUGATION_QUERY_CONFIG;

  async create(item: ICorrugation): Promise<ICorrugation> {
    const knex = db("erp");
    const corrugation = await knex.transaction(async (trx) => {
      const [created] = await trx(this.tableName)
        .insert({
          uuid: item.uuid,
          code: item.code,
          description: item.description,
          theoreticalGrammage: item.theoreticalGrammage,
          suggestedWidth: item.suggestedWidth,
          caliper: item.caliper,
          corrugationClassId: item.corrugationClassId,
          companyId: item.companyId,
        })
        .returning("*");

      if (item.layers?.length) {
        await this.insertLayers(trx, created.id, item.layers);
      }
      return created;
    });

    return (
      (await this.getByUuid(corrugation.uuid)) ??
      this.mapToInterface(corrugation)
    );
  }

  /**
   * Insert a layer stack for a corrugation. Positions are renumbered 1..N in
   * the given order (mirrors Procusto's grid renumbering — module 05).
   */
  private async insertLayers(
    trx: any,
    corrugationId: number,
    layers: ICorrugationLayer[],
  ): Promise<void> {
    const rows = layers.map((layer, index) => ({
      uuid: uuidv4(),
      corrugationId,
      position: index + 1,
      isLiner: layer.isLiner ?? false,
      paperClassId: layer.paperClassId ?? null,
      fluteTypeId: layer.fluteTypeId ?? null,
    }));
    if (rows.length) {
      await trx("corrugation_layers").insert(rows);
    }
  }

  /**
   * Reconcile the layer stack against what is stored (the Capas grid is edited
   * as a unit, but a save must not rewrite the rows it did not change).
   * `layers === undefined` leaves the stack untouched; `[]` clears it.
   *
   * Rows are matched by `uuid`, with `setDiff`'s array-ordinal fallback for
   * clients that do not send one yet. A client uuid is an identity *reference*:
   * one that matches nothing stored means a new row with a fresh server uuid.
   *
   * Statement order is load-bearing. `UNIQUE("corrugationId", "position")` is
   * non-deferrable, so renumbering survivors in place collides mid-way with
   * `23505`: (i) DELETE the rows the payload dropped, (ii) one bulk UPDATE
   * flipping every mover's `position` negative to vacate the 1..N range
   * (negatives are free — real positions are 1..N and unique, so their
   * negations are unique too), (iii) the per-row UPDATEs that land the final
   * positions and any other changed column, (iv) the INSERTs. An identical
   * payload issues none of the four.
   *
   * Keeps its own transaction: `update()` calls this before and outside the
   * parent-row UPDATE, and unifying the two is P1's job, not this one's.
   */
  async replaceLayers(
    corrugationId: number,
    layers: ICorrugationLayer[],
  ): Promise<void> {
    const knex = db("erp");
    await knex.transaction(async (trx) => {
      const existing: StoredLayer[] = await trx("corrugation_layers")
        .where("corrugationId", corrugationId)
        .orderBy("position", "asc");

      // Array order is the display order: `position` is derived server-side,
      // exactly as insertLayers does for the create path.
      const incoming: IncomingLayer[] = layers.map((layer, index) => ({
        uuid: layer.uuid,
        position: index + 1,
        isLiner: layer.isLiner ?? false,
        paperClassId: layer.paperClassId ?? null,
        fluteTypeId: layer.fluteTypeId ?? null,
      }));

      const diff = diffKeyedRows(incoming, existing, {
        keyOfIncoming: (layer) => layer.uuid,
        keyOfExisting: (layer) => layer.uuid,
        changedColumns: changedLayerColumns,
      });

      if (diff.deletes.length) {
        await trx("corrugation_layers")
          .whereIn(
            "id",
            diff.deletes.map((layer) => layer.id),
          )
          .delete();
      }

      const movers = diff.updates.filter(
        (update) => update.changes.position !== undefined,
      );
      if (movers.length) {
        await trx("corrugation_layers")
          .where("corrugationId", corrugationId)
          .whereIn(
            "id",
            movers.map((update) => update.existing.id),
          )
          .update({ position: trx.raw('-"position"') });
      }

      for (const update of diff.updates) {
        await trx("corrugation_layers")
          .where("id", update.existing.id)
          .update({ ...update.changes, updatedAt: trx.fn.now() });
      }

      if (diff.inserts.length) {
        // SECURITY: the uuid is minted here, never taken from the payload.
        await trx("corrugation_layers").insert(
          diff.inserts.map(({ incoming: layer }) => ({
            uuid: uuidv4(),
            corrugationId,
            position: layer.position,
            isLiner: layer.isLiner,
            paperClassId: layer.paperClassId,
            fluteTypeId: layer.fluteTypeId,
          })),
        );
      }
    });
  }

  private async loadLayers(
    corrugationId: number,
  ): Promise<ICorrugationLayer[]> {
    const knex = db("erp");
    const rows = await knex("corrugation_layers as cl")
      .select(
        "cl.*",
        knex.raw(
          `CASE WHEN pc.id IS NOT NULL THEN to_jsonb(pc) END as "paperClass"`,
        ),
        knex.raw(
          `CASE WHEN ft.id IS NOT NULL THEN to_jsonb(ft) END as "fluteType"`,
        ),
      )
      .leftJoin("paper_classes as pc", "cl.paperClassId", "pc.id")
      .leftJoin("flute_types as ft", "cl.fluteTypeId", "ft.id")
      .where("cl.corrugationId", corrugationId)
      .orderBy("cl.position", "asc");

    // SECURITY: strip numeric ids from nested objects (uuid-only surface).
    return rows.map((row: any) => {
      const strip = (obj: any) => {
        if (!obj) return null;
        const { id, ...rest } = obj;
        return rest;
      };
      return {
        uuid: row.uuid,
        position: row.position,
        isLiner: row.isLiner,
        paperClass: strip(row.paperClass),
        fluteType: strip(row.fluteType),
      };
    });
  }

  async getById(id: number): Promise<ICorrugation | null> {
    const knex = db("erp");
    const corrugation = await knex(this.tableName).where("id", id).first();

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ICorrugation | null> {
    const knex = db("erp");
    const query = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`
          CASE
            WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
            ELSE NULL
          END as "corrugationClass"
        `),
      )
      .leftJoin(
        "corrugation_classes as cc",
        `${this.tableName}.corrugationClassId`,
        "cc.id",
      )
      .where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const corrugation = await query.first();

    if (!corrugation) return null;
    // mapToInterface strips numeric ids from the response surface; the id is
    // only needed internally to load the layer stack.
    const mapped = this.mapToInterface(corrugation);
    mapped.layers = await this.loadLayers(corrugation.id);
    return mapped;
  }

  async update(
    id: number,
    item: Partial<ICorrugation>,
  ): Promise<ICorrugation | null> {
    const knex = db("erp");

    // Layers are replaced wholesale when provided; undefined leaves them as-is.
    if (item.layers !== undefined) {
      await this.replaceLayers(id, item.layers);
    }

    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.theoreticalGrammage !== undefined)
      updateData.theoreticalGrammage = item.theoreticalGrammage;
    if (item.suggestedWidth !== undefined)
      updateData.suggestedWidth = item.suggestedWidth;
    if (item.caliper !== undefined) updateData.caliper = item.caliper;
    if (item.corrugationClassId !== undefined)
      updateData.corrugationClassId = item.corrugationClassId;

    updateData.updatedAt = knex.fn.now();

    const [corrugation] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    if (!corrugation) return null;
    const mapped = this.mapToInterface(corrugation);
    mapped.layers = await this.loadLayers(id);
    return mapped;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<ICorrugation>> {
    const knex = db("erp");
    const offset = (page - 1) * limit;

    const [corrugations, totalResult] = await Promise.all([
      knex(this.tableName)
        .select(
          `${this.tableName}.*`,
          knex.raw(`
            CASE
              WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
              ELSE NULL
            END as "corrugationClass"
          `),
        )
        .leftJoin(
          "corrugation_classes as cc",
          `${this.tableName}.corrugationClassId`,
          "cc.id",
        )
        .orderBy(`${this.tableName}.code`, "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: corrugations.map((item) => this.mapToInterface(item)),
      page,
      limit,
      count: corrugations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICorrugation>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`
          CASE
            WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
            ELSE NULL
          END as "corrugationClass"
        `),
      )
      .leftJoin(
        "corrugation_classes as cc",
        `${this.tableName}.corrugationClassId`,
        "cc.id",
      );

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [corrugations, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: corrugations.map((item) => this.mapToInterface(item)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: corrugations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  // SECURITY: never expose numeric ids; foreign keys are returned as nested objects keyed by UUID.
  private mapToInterface(record: any): ICorrugation {
    let corrugationClass = undefined;
    if (record.corrugationClass) {
      const { id, ...classWithoutId } = record.corrugationClass;
      corrugationClass = classWithoutId;
    }

    return {
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      theoreticalGrammage: record.theoreticalGrammage
        ? parseFloat(record.theoreticalGrammage)
        : undefined,
      suggestedWidth: record.suggestedWidth
        ? parseFloat(record.suggestedWidth)
        : undefined,
      caliper: record.caliper ? parseFloat(record.caliper) : undefined,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      corrugationClass,
    };
  }

  private mapToInternalInterface(
    record: any,
  ): ICorrugation & { id: number; corrugationClassId?: number } {
    return {
      id: record.id,
      corrugationClassId: record.corrugationClassId,
      ...this.mapToInterface(record),
    };
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.id`).first();
    return record ? record.id : null;
  }
}
