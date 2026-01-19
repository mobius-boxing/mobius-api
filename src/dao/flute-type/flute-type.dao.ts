import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IFluteType } from "../../interfaces/flute-type/flute-type.interfaces";
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
 * Flute Type filter configuration
 */
const FLUTE_TYPE_FILTERS: FilterConfigs = {
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
 * Flute Type sort configuration
 */
const FLUTE_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  fluteFactor: { column: "fluteFactor" },
  length: { column: "length" },
  width: { column: "width" },
  height: { column: "height" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Flute Type query builder configuration
 */
const FLUTE_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "flute_types",
  {
    filters: FLUTE_TYPE_FILTERS,
    sorting: FLUTE_TYPE_SORTING,
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

export class FluteTypeDAO implements IBaseDAO<IFluteType> {
  private tableName = "flute_types";
  private queryConfig = FLUTE_TYPE_QUERY_CONFIG;

  /**
   * Create a new flute type
   */
  async create(item: IFluteType): Promise<IFluteType> {
    const knex = KnexManager.getConnection();
    const [fluteType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
        fluteFactor: item.fluteFactor,
        length: item.length,
        width: item.width,
        height: item.height,
      })
      .returning("*");

    return this.mapToInterface(fluteType);
  }

  /**
   * Get flute type by ID
   */
  async getById(id: number): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const fluteType = await knex(this.tableName).where("id", id).first();

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  /**
   * Get flute type by UUID
   */
  async getByUuid(uuid: string): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const fluteType = await knex(this.tableName).where("uuid", uuid).first();

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  /**
   * Update flute type by ID
   */
  async update(
    id: number,
    item: Partial<IFluteType>,
  ): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.fluteFactor !== undefined)
      updateData.fluteFactor = item.fluteFactor;
    if (item.length !== undefined) updateData.length = item.length;
    if (item.width !== undefined) updateData.width = item.width;
    if (item.height !== undefined) updateData.height = item.height;

    updateData.updatedAt = knex.fn.now();

    const [fluteType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  /**
   * Delete flute type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all flute types with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IFluteType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [fluteTypes, totalResult] = await Promise.all([
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
      data: fluteTypes.map((fluteType) => this.mapToInterface(fluteType)),
      page,
      limit,
      count: fluteTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all flute types with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code: Filter by code (ILIKE)
   * - description: Filter by description (ILIKE)
   * - search: Full-text search on code, description (e.g., ?search=TEST)
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IFluteType>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Build main query
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    // Build count query (same filters, no pagination/sorting)
    const countQuery = knex(this.tableName);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    // Execute both queries in parallel
    const [fluteTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: fluteTypes.map((fluteType) => this.mapToInterface(fluteType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: fluteTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IFluteType {
    return {
      id: record.id,
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      fluteFactor: record.fluteFactor
        ? parseFloat(record.fluteFactor)
        : undefined,
      length: record.length ? parseFloat(record.length) : undefined,
      width: record.width ? parseFloat(record.width) : undefined,
      height: record.height ? parseFloat(record.height) : undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
