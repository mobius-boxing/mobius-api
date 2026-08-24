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
   * Replace the layer stack wholesale (the Capas grid is edited as a unit).
   * `layers === undefined` leaves the stack untouched; `[]` clears it.
   */
  async replaceLayers(
    corrugationId: number,
    layers: ICorrugationLayer[],
  ): Promise<void> {
    const knex = db("erp");
    await knex.transaction(async (trx) => {
      await trx("corrugation_layers")
        .where("corrugationId", corrugationId)
        .delete();
      await this.insertLayers(trx, corrugationId, layers);
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
