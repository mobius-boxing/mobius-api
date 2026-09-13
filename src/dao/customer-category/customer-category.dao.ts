import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICustomerCategory } from "../../interfaces/customer-category/customer-category.interfaces";
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
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import { Request } from "express";

// companyId is handled separately (companyFilterScope): `filters.companyId` holds a uuid, not a column value.
const CUSTOMER_CATEGORY_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const CUSTOMER_CATEGORY_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const CUSTOMER_CATEGORY_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "customer_categories",
  {
    filters: CUSTOMER_CATEGORY_FILTERS,
    sorting: CUSTOMER_CATEGORY_SORTING,
    search: {
      columns: ["name"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "name",
      order: "asc",
    },
  },
);

export class CustomerCategoryDAO implements IBaseDAO<ICustomerCategory> {
  private tableName = "customer_categories";
  private queryConfig = CUSTOMER_CATEGORY_QUERY_CONFIG;

  async create(item: ICustomerCategory): Promise<ICustomerCategory> {
    const knex = db("tenant");
    const [category] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        name: item.name,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(category);
  }

  async getById(id: number): Promise<ICustomerCategory | null> {
    const knex = db("tenant");
    const category = await knex(this.tableName).where("id", id).first();

    return category ? this.mapToInterface(category) : null;
  }

  // companyId filter, when present, doubles as an ownership check (null if not in user's company).
  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<ICustomerCategory | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    applyCompanyScope(query, this.tableName, companyId);

    const category = await query.select(`${this.tableName}.*`).first();

    return category ? this.mapToInterface(category) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = db("tenant");
    const category = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return category ? category.id : null;
  }

  async update(
    id: number,
    item: Partial<ICustomerCategory>,
  ): Promise<ICustomerCategory | null> {
    const knex = db("tenant");
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.companyId !== undefined) updateData.companyId = item.companyId;

    updateData.updatedAt = knex.fn.now();

    const [category] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return category ? this.mapToInterface(category) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("tenant");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
    companyId?: CompanyScope,
  ): Promise<IDataPaginator<ICustomerCategory>> {
    const knex = db("tenant");
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
    const countQuery = knex(this.tableName);

    applyCompanyScope(query, this.tableName, companyId);
    applyCompanyScope(countQuery, this.tableName, companyId);

    const [categories, totalResult] = await Promise.all([
      query
        .select(`${this.tableName}.*`)
        .orderBy(`${this.tableName}.name`, "asc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: categories.map((category) => this.mapToInterface(category)),
      page,
      limit,
      count: categories.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<ICustomerCategory>> {
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

    const [categories, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: categories.map((category) => this.mapToInterface(category)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: categories.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): ICustomerCategory {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
