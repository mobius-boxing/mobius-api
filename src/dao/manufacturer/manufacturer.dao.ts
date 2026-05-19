import KnexManager from "../../database/KnexConnection";
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
import { Request } from "express";

/**
 * Manufacturer filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
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
};

/**
 * Manufacturer sort configuration
 */
const MANUFACTURER_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Manufacturer query builder configuration
 */
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

  /**
   * Create a new manufacturer
   */
  async create(item: IManufacturer): Promise<IManufacturer> {
    const knex = KnexManager.getConnection();
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

  /**
   * Get manufacturer by ID
   */
  async getById(id: number): Promise<IManufacturer | null> {
    const knex = KnexManager.getConnection();
    const manufacturer = await knex(this.tableName).where("id", id).first();

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  /**
   * Get manufacturer by UUID
   */
  async getByUuid(uuid: string): Promise<IManufacturer | null> {
    const knex = KnexManager.getConnection();
    const manufacturer = await knex(this.tableName).where("uuid", uuid).first();

    return manufacturer ? this.mapToInterface(manufacturer) : null;
  }

  /**
   * Get manufacturer numeric ID by UUID string
   * Used for converting UUID foreign keys to database IDs
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const manufacturer = await knex(this.tableName)
      .where("uuid", uuid)
      .select("id")
      .first();

    return manufacturer ? manufacturer.id : null;
  }

  /**
   * Update manufacturer by ID
   */
  async update(
    id: number,
    item: Partial<IManufacturer>,
  ): Promise<IManufacturer | null> {
    const knex = KnexManager.getConnection();
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

  /**
   * Delete manufacturer by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all manufacturers with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IManufacturer>> {
    const knex = KnexManager.getConnection();
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

  /**
   * Get all manufacturers with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code, name: Filter by code or name (ILIKE)
   * - search: Full-text search on code and name (e.g., ?search=TEST)
   */
  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IManufacturer>> {
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

  /**
   * Map database record to interface
   */
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
