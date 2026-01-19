import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICorrugationClass } from "../../interfaces/corrugation-class/corrugation-class.interfaces";
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
 * Corrugation Class filter configuration
 */
const CORRUGATION_CLASS_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  description: {
    column: "description",
    operator: "ILIKE",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

/**
 * Corrugation Class sort configuration
 */
const CORRUGATION_CLASS_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Corrugation Class query builder configuration
 */
const CORRUGATION_CLASS_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "corrugation_classes",
  {
    filters: CORRUGATION_CLASS_FILTERS,
    sorting: CORRUGATION_CLASS_SORTING,
    search: {
      columns: ["code", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "code",
      order: "asc",
    },
  },
);

export class CorrugationClassDAO implements IBaseDAO<ICorrugationClass> {
  private tableName = "corrugation_classes";
  private queryConfig = CORRUGATION_CLASS_QUERY_CONFIG;

  /**
   * Create a new corrugation class
   */
  async create(item: ICorrugationClass): Promise<ICorrugationClass> {
    const knex = KnexManager.getConnection();
    const [corrugationClass] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(corrugationClass);
  }

  /**
   * Get corrugation class by ID
   */
  async getById(id: number): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const corrugationClass = await knex(this.tableName).where("id", id).first();

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  /**
   * Get corrugation class by UUID
   */
  async getByUuid(uuid: string): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const corrugationClass = await knex(this.tableName)
      .where("uuid", uuid)
      .first();

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  /**
   * Update corrugation class by ID
   */
  async update(
    id: number,
    item: Partial<ICorrugationClass>,
  ): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [corrugationClass] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  /**
   * Delete corrugation class by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all corrugation classes with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<ICorrugationClass>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [corrugationClasses, totalResult] = await Promise.all([
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
      data: corrugationClasses.map((item) => this.mapToInterface(item)),
      page,
      limit,
      count: corrugationClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all corrugation classes with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code: Filter by code (ILIKE)
   * - description: Filter by description (ILIKE)
   * - search: Full-text search on code, description (e.g., ?search=TEST)
   */
  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<ICorrugationClass>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [corrugationClasses, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: corrugationClasses.map((item) => this.mapToInterface(item)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: corrugationClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   * SECURITY: Never expose numeric IDs to frontend - only UUIDs
   */
  private mapToInterface(record: any): ICorrugationClass {
    return {
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Internal method to map with ID (for internal use only, never send to frontend)
   */
  private mapToInternalInterface(
    record: any,
  ): ICorrugationClass & { id: number } {
    return {
      id: record.id,
      ...this.mapToInterface(record),
    };
  }

  /**
   * Get internal numeric ID by UUID (for internal use only, never expose to frontend)
   * Used by controllers when they need to perform update/delete operations
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }
}
