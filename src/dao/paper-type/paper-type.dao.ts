import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperType } from "../../interfaces/paper-type/paper-type.interfaces";
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
 * Paper Type filter configuration
 */
const PAPER_TYPE_FILTERS: FilterConfigs = {
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
 * Paper Type sort configuration
 */
const PAPER_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Paper Type query builder configuration
 */
const PAPER_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "paper_types",
  {
    filters: PAPER_TYPE_FILTERS,
    sorting: PAPER_TYPE_SORTING,
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

export class PaperTypeDAO implements IBaseDAO<IPaperType> {
  private tableName = "paper_types";
  private queryConfig = PAPER_TYPE_QUERY_CONFIG;

  /**
   * Create a new paper type
   */
  async create(item: IPaperType): Promise<IPaperType> {
    const knex = KnexManager.getConnection();
    const [paperType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(paperType);
  }

  /**
   * Get paper type by ID
   */
  async getById(id: number): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const paperType = await knex(this.tableName).where("id", id).first();

    return paperType ? this.mapToInterface(paperType) : null;
  }

  /**
   * Get paper type by UUID
   */
  async getByUuid(uuid: string): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const paperType = await knex(this.tableName).where("uuid", uuid).first();

    return paperType ? this.mapToInterface(paperType) : null;
  }

  /**
   * Get paper type internal ID by UUID
   */
  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

  /**
   * Update paper type by ID
   */
  async update(
    id: number,
    item: Partial<IPaperType>,
  ): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [paperType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperType ? this.mapToInterface(paperType) : null;
  }

  /**
   * Delete paper type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all paper types with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IPaperType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [paperTypes, totalResult] = await Promise.all([
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
      data: paperTypes.map((paperType) => this.mapToInterface(paperType)),
      page,
      limit,
      count: paperTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all paper types with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code: Filter by code (ILIKE)
   * - description: Filter by description (ILIKE)
   * - search: Full-text search on code, description (e.g., ?search=TEST)
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPaperType>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [paperTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperTypes.map((paperType) => this.mapToInterface(paperType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: paperTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IPaperType {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
