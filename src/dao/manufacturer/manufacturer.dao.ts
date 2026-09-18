import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IManufacturer } from "../../interfaces/manufacturer/manufacturer.interfaces";
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
import { dayRangeFilters } from "../../utils/filterRanges";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import { Request } from "express";

// companyId is intentionally absent — getAllWithFilters scopes through
// companyFilterScope(req); `filters.companyId` holds a uuid, not a column value.
const MANUFACTURER_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  name: {
    column: "name",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
  ...dayRangeFilters("createdAt", "createdAt", { timestamp: true }),
};

const MANUFACTURER_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const MANUFACTURER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "manufacturers",
  {
    filters: MANUFACTURER_FILTERS,
    sorting: MANUFACTURER_SORTING,
    search: {
      columns: ["code", "name"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "code",
      order: "asc",
    },
  },
);

export class ManufacturerDAO implements IBaseDAO<IManufacturer> {
  private tableName = "manufacturers";
  private queryConfig = MANUFACTURER_QUERY_CONFIG;

  async create(item: IManufacturer): Promise<IManufacturer> {
    const knex = db("tenant");
    const [manufacturer] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        name: item.name,
      })
      .returning("*");

    return this.mapToInterface(manufacturer);
  }

  async getById(id: number): Promise<IManufacturer | null> {
    const knex = db("tenant");
    const manufacturer = await knex(this.tableName).where("id", id).first();

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<IManufacturer | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId);
    const manufacturer = await query.select(`${this.tableName}.*`).first();

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<number | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId);
    const manufacturer = await query.select(`${this.tableName}.id`).first();

    return manufacturer ? manufacturer.id : null;
  }

  async update(
    id: number,
    item: Partial<IManufacturer>,
  ): Promise<IManufacturer | null> {
    const knex = db("tenant");
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;

    updateData.updatedAt = knex.fn.now();

    const [manufacturer] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("tenant");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * @deprecated Use getAllWithFilters for advanced querying.
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IManufacturer>> {
    const knex = db("tenant");
    const offset = (page - 1) * limit;

    const [manufacturers, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("code", "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: manufacturers.map((manufacturer) =>
        this.mapToInterface(manufacturer),
      ),
      page,
      limit,
      count: manufacturers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IManufacturer>> {
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

    applyCompanyScope(dataQuery, this.tableName, companyId);

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    applyCompanyScope(countQuery, this.tableName, companyId);

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [manufacturers, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: manufacturers.map((manufacturer) =>
        this.mapToInterface(manufacturer),
      ),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: manufacturers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IManufacturer {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
