import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IColorType } from "../../interfaces/color-type/color-type.interfaces";
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

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
const COLOR_TYPE_FILTERS: FilterConfigs = {
  name: { column: "name", operator: "ILIKE" },
  description: { column: "description", operator: "ILIKE" },
  uuid: { column: "uuid", operator: "=" },
};

const COLOR_TYPE_SORTING: SortConfigs = {
  name: { column: "name" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const COLOR_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "color_types",
  {
    filters: COLOR_TYPE_FILTERS,
    sorting: COLOR_TYPE_SORTING,
    search: { columns: ["name", "description"], operator: "ILIKE" },
    defaultSort: { column: "name", order: "asc" },
  },
);

export class ColorTypeDAO implements IBaseDAO<IColorType> {
  private tableName = "color_types";
  private queryConfig = COLOR_TYPE_QUERY_CONFIG;

  async create(item: IColorType): Promise<IColorType> {
    const knex = KnexManager.getConnection();
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        name: item.name,
        description: item.description,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getById(id: number): Promise<IColorType | null> {
    const knex = KnexManager.getConnection();
    const row = await knex(this.tableName).where("id", id).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IColorType | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.*`).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row ? row.id : null;
  }

  async update(
    id: number,
    item: Partial<IColorType>,
  ): Promise<IColorType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};
    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined) updateData.description = item.description;
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

  /** @deprecated Use getAllWithFilters for advanced querying. */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IColorType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;
    const [rows, totalResult] = await Promise.all([
      knex(this.tableName).select("*").orderBy("name", "asc").limit(limit).offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;
    return {
      success: true,
      data: rows.map((row) => this.mapToInterface(row)),
      page,
      limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IColorType>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
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
      data: rows.map((row) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IColorType {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      name: record.name,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
