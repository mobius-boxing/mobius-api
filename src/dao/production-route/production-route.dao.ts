import { Request } from "express";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import {
  SUPPLY_TABLES,
  IProductionRoute,
  IRouteStage,
  StageSupplyType,
} from "../../interfaces/production-route/production-route.interfaces";
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
import { v4 as uuidv4 } from "uuid";

// Re-exported for existing importers; the definition lives in the interfaces
// (single source with the type union and the DTO/validator lists).
export { SUPPLY_TABLES };

const ROUTE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  name: { column: "name", operator: "ILIKE" },
  isGlobal: {
    column: "isGlobal",
    operator: "=",
    transform: (v: string) => v === "true",
  },
  active: {
    column: "active",
    operator: "=",
    transform: (v: string) => v === "true",
  },
  isDefault: {
    column: "isDefault",
    operator: "=",
    transform: (v: string) => v === "true",
  },
};

const ROUTE_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
};

const ROUTE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "production_routes",
  {
    filters: ROUTE_FILTERS,
    sorting: ROUTE_SORTING,
    search: { columns: ["name"], operator: "ILIKE" },
    defaultSort: { column: "name", order: "asc" },
  },
);

export class ProductionRouteDAO {
  private tableName = "production_routes";
  private queryConfig = ROUTE_QUERY_CONFIG;

  // ── Create / update (stages replaced wholesale, transactional) ────────────

  async create(item: IProductionRoute): Promise<IProductionRoute> {
    const knex = KnexManager.getConnection();
    const uuid = item.uuid ?? uuidv4();
    await knex.transaction(async (trx) => {
      if (item.isDefault) await this.clearDefault(trx, item.companyId!);
      const [route] = await trx(this.tableName)
        .insert({
          uuid,
          companyId: item.companyId,
          name: item.name,
          isGlobal: item.isGlobal ?? false,
          active: item.active ?? true,
          isDefault: item.isDefault ?? false,
        })
        .returning("*");
      await this.insertStages(trx, route.id, item.stages ?? []);
    });
    return (await this.getByUuid(uuid))!;
  }

  async update(
    id: number,
    item: Partial<IProductionRoute>,
  ): Promise<IProductionRoute | null> {
    const knex = KnexManager.getConnection();
    const existing = await knex(this.tableName).where("id", id).first();
    if (!existing) return null;

    await knex.transaction(async (trx) => {
      if (item.isDefault === true) {
        await this.clearDefault(trx, existing.companyId);
      }
      const updateData: any = { updatedAt: trx.fn.now() };
      for (const key of ["name", "isGlobal", "active", "isDefault"] as const) {
        if (item[key] !== undefined) updateData[key] = item[key];
      }
      await trx(this.tableName).where("id", id).update(updateData);

      if (item.stages !== undefined) {
        await trx("production_route_stages").where("routeId", id).delete();
        await this.insertStages(trx, id, item.stages);
      }
    });
    return this.getByUuid(existing.uuid);
  }

  /** Single-default invariant (app-level, per spec — not a DB constraint). */
  private async clearDefault(trx: any, companyId: number): Promise<void> {
    await trx(this.tableName)
      .where({ companyId, isDefault: true })
      .update({ isDefault: false, updatedAt: trx.fn.now() });
  }

  /** Stages renumbered 1..N by array order (Procusto renumber semantics). */
  private async insertStages(
    trx: any,
    routeId: number,
    stages: IRouteStage[],
  ): Promise<void> {
    for (const [index, stage] of stages.entries()) {
      const [created] = await trx("production_route_stages")
        .insert({
          uuid: uuidv4(),
          routeId,
          number: index + 1,
          description: stage.description ?? null,
          isCorrugation: stage.isCorrugation ?? false,
          setupTimeMinutes: stage.setupTimeMinutes ?? 0,
          machineTypeId: stage.machineTypeId ?? null,
        })
        .returning("id");
      const stageId = created.id ?? created;

      if (stage.machines?.length) {
        await trx("production_route_stage_machines").insert(
          stage.machines.map((m) => ({
            stageId,
            machineId: m.machineId,
            isPrimary: m.isPrimary ?? true,
          })),
        );
      }
      if (stage.supplies?.length) {
        await trx("production_route_stage_supplies").insert(
          stage.supplies.map((s) => ({
            uuid: uuidv4(),
            stageId,
            direction: s.direction,
            supplyType: s.supplyType,
            supplyId: s.supplyId,
            quantity: s.quantity ?? null,
            quantityType: s.quantityType ?? null,
            repetitionsWidth: s.repetitionsWidth ?? 1.0,
            repetitionsLength: s.repetitionsLength ?? 1.0,
            allowsSimilar: s.allowsSimilar ?? false,
            notes: s.notes ?? null,
          })),
        );
      }
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProductionRoute | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const route = await query.select(`${this.tableName}.*`).first();
    if (!route) return null;

    const stages = await this.loadStages(route.id);
    return { ...this.mapRoute(route), id: route.id, stages };
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  private async loadStages(routeId: number): Promise<IRouteStage[]> {
    const knex = KnexManager.getConnection();
    const stages = await knex("production_route_stages as st")
      .select(
        "st.*",
        knex.raw(`CASE WHEN mt.id IS NOT NULL THEN to_jsonb(mt) END as "machineType"`),
      )
      .leftJoin("machine_types as mt", "st.machineTypeId", "mt.id")
      .where("st.routeId", routeId)
      .orderBy("st.number", "asc");
    if (!stages.length) return [];

    const stageIds = stages.map((s: any) => s.id);
    const machines = await knex("production_route_stage_machines as sm")
      .select("sm.stageId", "sm.isPrimary", knex.raw(`to_jsonb(m) as machine`))
      .join("machines as m", "sm.machineId", "m.id")
      .whereIn("sm.stageId", stageIds);
    const supplies = await knex("production_route_stage_supplies")
      .whereIn("stageId", stageIds)
      .orderBy("id", "asc");

    // Batch-resolve supply display objects per type.
    const supplyRefs = new Map<string, { uuid: string; code?: string; name?: string }>();
    for (const [type, table] of Object.entries(SUPPLY_TABLES)) {
      const ids = [
        ...new Set(
          supplies
            .filter((s: any) => s.supplyType === type)
            .map((s: any) => s.supplyId),
        ),
      ];
      if (!ids.length) continue;
      const rows = await knex(table).whereIn("id", ids).select("id", "uuid", "code", "name");
      rows.forEach((r: any) =>
        supplyRefs.set(`${type}:${r.id}`, { uuid: r.uuid, code: r.code, name: r.name }),
      );
    }

    return stages.map((stage: any) => ({
      uuid: stage.uuid,
      number: stage.number,
      description: stage.description,
      isCorrugation: stage.isCorrugation,
      setupTimeMinutes: parseFloat(stage.setupTimeMinutes) || 0,
      machineTypeId: stage.machineTypeId,
      machineType: stage.machineType
        ? {
            uuid: stage.machineType.uuid,
            name: stage.machineType.name,
            corrugated: stage.machineType.corrugated,
          }
        : null,
      machines: machines
        .filter((m: any) => m.stageId === stage.id)
        .map((m: any) => ({
          isPrimary: m.isPrimary,
          machine: {
            uuid: m.machine.uuid,
            code: m.machine.code,
            description: m.machine.description,
          },
        })),
      supplies: supplies
        .filter((s: any) => s.stageId === stage.id)
        .map((s: any) => ({
          uuid: s.uuid,
          direction: s.direction,
          supplyType: s.supplyType,
          supplyId: s.supplyId,
          quantity: s.quantity != null ? parseFloat(s.quantity) : null,
          quantityType: s.quantityType,
          repetitionsWidth: parseFloat(s.repetitionsWidth),
          repetitionsLength: parseFloat(s.repetitionsLength),
          allowsSimilar: s.allowsSimilar,
          notes: s.notes,
          supply: supplyRefs.get(`${s.supplyType}:${s.supplyId}`) ?? null,
        })),
    }));
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  /** True when any part references this route (delete guard, spec 04). */
  async isReferencedByParts(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const hasParts = await knex.schema.hasTable("parts");
    if (!hasParts) return false;
    const row = await knex("parts").where("productionRouteId", id).select("id").first();
    return !!row;
  }

  // ── Clone / copy-stages (Clonar / CopiarEtapas) ───────────────────────────

  /** Clonar(): full copy; isDefault forced false. */
  async clone(sourceId: number, name: string): Promise<IProductionRoute> {
    const knex = KnexManager.getConnection();
    const source = await knex(this.tableName).where("id", sourceId).first();
    if (!source) throw new Error("Source route not found");
    const stages = await this.loadStagesForCopy(sourceId);
    return this.create({
      companyId: source.companyId,
      name,
      isGlobal: source.isGlobal,
      active: source.active,
      isDefault: false,
      stages,
    });
  }

  /** CopiarEtapas(src): clear own stages, deep-copy the source's. */
  async copyStages(targetId: number, sourceId: number): Promise<void> {
    const knex = KnexManager.getConnection();
    const stages = await this.loadStagesForCopy(sourceId);
    await knex.transaction(async (trx) => {
      await trx("production_route_stages").where("routeId", targetId).delete();
      await this.insertStages(trx, targetId, stages);
      await trx(this.tableName)
        .where("id", targetId)
        .update({ updatedAt: trx.fn.now() });
    });
  }

  /** Raw stage tree with numeric ids, ready for insertStages. */
  private async loadStagesForCopy(routeId: number): Promise<IRouteStage[]> {
    const knex = KnexManager.getConnection();
    const stages = await knex("production_route_stages")
      .where("routeId", routeId)
      .orderBy("number", "asc");
    const stageIds = stages.map((s: any) => s.id);
    const machines = stageIds.length
      ? await knex("production_route_stage_machines").whereIn("stageId", stageIds)
      : [];
    const supplies = stageIds.length
      ? await knex("production_route_stage_supplies").whereIn("stageId", stageIds)
      : [];
    return stages.map((stage: any) => ({
      number: stage.number,
      description: stage.description,
      isCorrugation: stage.isCorrugation,
      setupTimeMinutes: parseFloat(stage.setupTimeMinutes) || 0,
      machineTypeId: stage.machineTypeId,
      machines: machines
        .filter((m: any) => m.stageId === stage.id)
        .map((m: any) => ({ machineId: m.machineId, isPrimary: m.isPrimary })),
      supplies: supplies
        .filter((s: any) => s.stageId === stage.id)
        .map((s: any) => ({
          direction: s.direction,
          supplyType: s.supplyType,
          supplyId: s.supplyId,
          quantity: s.quantity != null ? parseFloat(s.quantity) : null,
          quantityType: s.quantityType,
          repetitionsWidth: parseFloat(s.repetitionsWidth),
          repetitionsLength: parseFloat(s.repetitionsLength),
          allowsSimilar: s.allowsSimilar,
          notes: s.notes,
        })),
    }));
  }

  async nameExists(companyId: number, name: string): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const row = await knex(this.tableName).where({ companyId, name }).select("id").first();
    return !!row;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IProductionRoute>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(
      `${this.tableName}.*`,
      knex.raw(
        `(select count(*) from production_route_stages st where st."routeId" = ${this.tableName}.id) as "stageCount"`,
      ),
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

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => ({
        ...this.mapRoute(row),
        stageCount: parseInt(row.stageCount, 10) || 0,
      })),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapRoute(record: any): IProductionRoute {
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      name: record.name,
      isGlobal: record.isGlobal,
      active: record.active,
      isDefault: record.isDefault,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
