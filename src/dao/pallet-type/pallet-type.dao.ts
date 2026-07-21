import { Request } from "express";
import { toNumberOut } from "../../utils/numbers";
import KnexManager from "../../database/KnexConnection";
import { IDataPaginator } from "../../database/d.types";
import { IPalletType } from "../../interfaces/palletization/palletization.interfaces";
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

const PALLET_TYPE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
};

const PALLET_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
};

const PALLET_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "pallet_types",
  {
    filters: PALLET_TYPE_FILTERS,
    sorting: PALLET_TYPE_SORTING,
    search: { columns: ["code", "description"], operator: "ILIKE" },
    defaultSort: { column: "code", order: "asc" },
  },
);

export class PalletTypeDAO {
  private tableName = "pallet_types";
  private queryConfig = PALLET_TYPE_QUERY_CONFIG;

  async create(item: IPalletType): Promise<IPalletType> {
    const knex = KnexManager.getConnection();
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code ?? null,
        description: item.description ?? null,
        length: item.length ?? null,
        width: item.width ?? null,
        weight: item.weight ?? null,
        height: item.height ?? null,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getByUuid(uuid: string, companyUuid?: string): Promise<IPalletType | null> {
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

  async update(id: number, item: Partial<IPalletType>): Promise<IPalletType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};
    for (const key of ["code", "description", "length", "width", "weight", "height"] as const) {
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPalletType>> {
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

  private mapToInterface(record: any): IPalletType {
    const num = toNumberOut;
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      length: num(record.length),
      width: num(record.width),
      weight: num(record.weight),
      height: num(record.height),
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
