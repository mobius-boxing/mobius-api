import { Request } from "express";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import { IMachineType } from "../../interfaces/machine/machine.interfaces";
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

const MACHINE_TYPE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  name: { column: "name", operator: "ILIKE" },
  corrugated: {
    column: "corrugated",
    operator: "=",
    transform: (v: string) => v === "true",
  },
};

const MACHINE_TYPE_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
};

const MACHINE_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "machine_types",
  {
    filters: MACHINE_TYPE_FILTERS,
    sorting: MACHINE_TYPE_SORTING,
    search: { columns: ["name", "attribute"], operator: "ILIKE" },
    defaultSort: { column: "name", order: "asc" },
  },
);

export class MachineTypeDAO {
  private tableName = "machine_types";
  private queryConfig = MACHINE_TYPE_QUERY_CONFIG;

  async create(item: IMachineType): Promise<IMachineType> {
    const knex = KnexManager.getConnection();
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        name: item.name,
        location: item.location ?? null,
        requiresDie: item.requiresDie ?? false,
        requiresPlate: item.requiresPlate ?? false,
        attribute: item.attribute ?? null,
        corrugated: item.corrugated ?? false,
        generatesSheets: item.generatesSheets ?? null,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IMachineType | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.*`).first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(id: number, item: Partial<IMachineType>): Promise<IMachineType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};
    for (const key of [
      "name",
      "location",
      "requiresDie",
      "requiresPlate",
      "attribute",
      "corrugated",
      "generatesSheets",
    ] as const) {
      if (item[key] !== undefined) updateData[key] = item[key];
    }
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IMachineType>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
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

  private mapToInterface(record: any): IMachineType {
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      name: record.name,
      location: record.location,
      requiresDie: record.requiresDie,
      requiresPlate: record.requiresPlate,
      attribute: record.attribute,
      corrugated: record.corrugated,
      generatesSheets: record.generatesSheets,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
