import KnexManager from "../../database/KnexConnection";
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
import { Request } from "express";

/**
 * CustomerCategory filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
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

/**
 * CustomerCategory sort configuration
 */
const CUSTOMER_CATEGORY_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * CustomerCategory query builder configuration
 */
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

  /**
   * Create a new customer category
   */
  async create(item: ICustomerCategory): Promise<ICustomerCategory> {
    const knex = KnexManager.getConnection();
    const [category] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        name: item.name,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(category);
  }

  /**
   * Get customer category by ID
   */
  async getById(id: number): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const category = await knex(this.tableName).where("id", id).first();

    return category ? this.mapToInterface(category) : null;
  }

  /**
   * Get customer category by UUID
   */
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    const category = await query.select(`${this.tableName}.*`).first();

    return category ? this.mapToInterface(category) : null;
  }

  /**
   * Get customer category numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const category = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return category ? category.id : null;
  }

  /**
   * Update customer category by ID
   */
  async update(
    id: number,
    item: Partial<ICustomerCategory>,
  ): Promise<ICustomerCategory | null> {
    const knex = KnexManager.getConnection();
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

  /**
   * Delete customer category by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all customer categories with pagination
   */
  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<ICustomerCategory>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const query = knex(this.tableName);
    const countQuery = knex(this.tableName);

    // Filter by company UUID if provided
    if (companyUuid) {
      query
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

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

  /**
   * Get all customer categories with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   * Handles companyId as UUID (joins with companies table)
   */
  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<ICustomerCategory>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Extract companyId (UUID) from filters - handle it separately via join
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

    // Join with companies if filtering by company UUID
    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
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

  /**
   * Map database record to interface
   */
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
