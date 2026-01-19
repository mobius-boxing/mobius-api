import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICompany } from "../../interfaces/company/company.interfaces";
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
 * Company filter configuration
 */
const COMPANY_FILTERS: FilterConfigs = {
  name: {
    column: "name",
    operator: "ILIKE",
  },
  isActive: {
    column: "isActive",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

/**
 * Company sort configuration
 */
const COMPANY_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Company query builder configuration
 */
const COMPANY_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig("companies", {
  filters: COMPANY_FILTERS,
  sorting: COMPANY_SORTING,
  search: {
    columns: ["name", "description"],
    operator: "ILIKE",
  },
  defaultSort: {
    column: "createdAt",
    order: "desc",
  },
});

export class CompanyDAO implements IBaseDAO<ICompany> {
  private tableName = "companies";
  private queryConfig = COMPANY_QUERY_CONFIG;

  /**
   * Create a new company
   */
  async create(item: ICompany): Promise<ICompany> {
    const knex = KnexManager.getConnection();
    const [company] = await knex(this.tableName)
      .insert({
        name: item.name,
        description: item.description,
        isActive: item.isActive ?? true,
      })
      .returning("*");

    return this.mapToInterface(company);
  }

  /**
   * Get company by numeric ID
   */
  async getById(id: number): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();
    const company = await knex(this.tableName).where("id", id).first();

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Get company by UUID string
   */
  async getByUuid(uuid: string): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();
    const company = await knex(this.tableName).where("uuid", uuid).first();

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Get company numeric ID by UUID string
   * Used for converting JWT token's company UUID to database ID
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const company = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return company ? company.id : null;
  }

  /**
   * Update company by numeric ID
   */
  async update(id: number, item: Partial<ICompany>): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.isActive !== undefined) updateData.isActive = item.isActive;

    updateData.updatedAt = knex.fn.now();

    const [company] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return company ? this.mapToInterface(company) : null;
  }

  /**
   * Delete company by numeric ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all companies with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<ICompany>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [companies, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: companies.map((company) => this.mapToInterface(company)),
      page,
      limit,
      count: companies.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all companies with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=name&sortOrder=asc)
   * - name: Filter by name (ILIKE)
   * - isActive: Filter by active status (boolean)
   * - search: Full-text search on name, description (e.g., ?search=TEST)
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICompany>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [companies, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: companies.map((company) => this.mapToInterface(company)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: companies.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Get company with user count by UUID
   */
  async getCompanyWithUserCount(uuid: string): Promise<ICompany | null> {
    const knex = KnexManager.getConnection();

    const company = await knex(this.tableName)
      .select("companies.*", knex.raw("COUNT(users.id)::int as user_count"))
      .leftJoin("users", "companies.id", "users.companyId")
      .where("companies.uuid", uuid)
      .groupBy("companies.id")
      .first();

    if (!company) return null;

    const mapped = this.mapToInterface(company);
    mapped.userCount = company.user_count;

    return mapped;
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ICompany {
    return {
      id: record.id,
      uuid: record.uuid,
      name: record.name,
      description: record.description,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
