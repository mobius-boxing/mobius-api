import { Request } from "express";
import { toNumberOut } from "../../utils/numbers";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import { IMachine } from "../../interfaces/machine/machine.interfaces";
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

const MACHINE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
  machineTypeId: {
    column: "machineTypeId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
};

const MACHINE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
};

const MACHINE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("machines", {
  filters: MACHINE_FILTERS,
  sorting: MACHINE_SORTING,
  search: { columns: ["code", "description"], operator: "ILIKE" },
  defaultSort: { column: "code", order: "asc" },
});

const SCALAR_FIELDS = [
  "code",
  "description",
  "machineTypeId",
  "sheetWidthMin",
  "sheetLengthMin",
  "sheetWidthMax",
  "sheetLengthMax",
  "width",
  "setupTime",
  "maxScoreLines",
  "sourceWarehouseId",
  "destinationWarehouseId",
  "linearMeters",
  "boxWidthMin",
  "boxWidthMax",
  "boxLengthMin",
  "boxLengthMax",
  "boxHeightMin",
  "boxHeightMax",
] as const;

export class MachineDAO {
  private tableName = "machines";
  private queryConfig = MACHINE_QUERY_CONFIG;

  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`CASE WHEN mt.id IS NOT NULL THEN to_jsonb(mt) END as "machineType"`),
        knex.raw(`CASE WHEN sw.id IS NOT NULL THEN to_jsonb(sw) END as "sourceWarehouse"`),
        knex.raw(`CASE WHEN dw.id IS NOT NULL THEN to_jsonb(dw) END as "destinationWarehouse"`),
      )
      .leftJoin("machine_types as mt", `${this.tableName}.machineTypeId`, "mt.id")
      .leftJoin("warehouses as sw", `${this.tableName}.sourceWarehouseId`, "sw.id")
      .leftJoin("warehouses as dw", `${this.tableName}.destinationWarehouseId`, "dw.id");
  }

  async create(item: IMachine): Promise<IMachine> {
    const knex = KnexManager.getConnection();
    const insertData: any = { uuid: item.uuid, companyId: item.companyId };
    for (const key of SCALAR_FIELDS) {
      if (item[key] !== undefined) insertData[key] = item[key];
    }
    const [row] = await knex(this.tableName).insert(insertData).returning("*");
    return (await this.getByUuid(row.uuid)) ?? this.mapToInterface(row);
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IMachine | null> {
    const knex = KnexManager.getConnection();
    const query = this.selectWithJoins(knex).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(id: number, item: Partial<IMachine>): Promise<IMachine | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};
    for (const key of SCALAR_FIELDS) {
      if (item[key] !== undefined) updateData[key] = item[key];
    }
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? ((await this.getByUuid(row.uuid)) ?? this.mapToInterface(row)) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IMachine>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // machineTypeUuid convenience filter for the routes UI.
    const machineTypeUuid = parsedQuery.filters.machineTypeUuid as string | undefined;
    delete parsedQuery.filters.machineTypeUuid;
    if (machineTypeUuid) {
      const mt = await knex("machine_types")
        .where("uuid", machineTypeUuid)
        .select("id")
        .first();
      parsedQuery.filters.machineTypeId = String(mt?.id ?? -1);
    }

    const dataQuery = this.selectWithJoins(knex);
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
      data: rows.map((row: any) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  // SECURITY: uuid-only surface; nested objects stripped of numeric ids.
  private mapToInterface(record: any): IMachine {
    const num = toNumberOut;
    const stripType = (obj: any) =>
      obj ? { uuid: obj.uuid, name: obj.name, corrugated: obj.corrugated } : null;
    const stripWh = (obj: any) => (obj ? { uuid: obj.uuid, name: obj.name } : null);
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      sheetWidthMin: num(record.sheetWidthMin),
      sheetLengthMin: num(record.sheetLengthMin),
      sheetWidthMax: num(record.sheetWidthMax),
      sheetLengthMax: num(record.sheetLengthMax),
      width: num(record.width),
      setupTime: num(record.setupTime) ?? 0,
      maxScoreLines: num(record.maxScoreLines),
      linearMeters: num(record.linearMeters),
      boxWidthMin: num(record.boxWidthMin),
      boxWidthMax: num(record.boxWidthMax),
      boxLengthMin: num(record.boxLengthMin),
      boxLengthMax: num(record.boxLengthMax),
      boxHeightMin: num(record.boxHeightMin),
      boxHeightMax: num(record.boxHeightMax),
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      machineType: stripType(record.machineType),
      sourceWarehouse: stripWh(record.sourceWarehouse),
      destinationWarehouse: stripWh(record.destinationWarehouse),
    };
  }
}
