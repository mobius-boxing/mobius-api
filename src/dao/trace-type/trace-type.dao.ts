import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ITraceType } from "../../interfaces/trace-type/trace-type.interfaces";
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
 * Trace Type filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const TRACE_TYPE_FILTERS: FilterConfigs = {
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
 * Trace Type sort configuration
 */
const TRACE_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Trace Type query builder configuration
 */
const TRACE_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "trace_types",
  {
    filters: TRACE_TYPE_FILTERS,
    sorting: TRACE_TYPE_SORTING,
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

export class TraceTypeDAO implements IBaseDAO<ITraceType> {
  private tableName = "trace_types";
  private queryConfig = TRACE_TYPE_QUERY_CONFIG;

  /**
   * Create a new trace type
   */
  async create(item: ITraceType): Promise<ITraceType> {
    const knex = KnexManager.getConnection();
    const [traceType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(traceType);
  }

  /**
   * Get trace type by ID
   */
  async getById(id: number): Promise<ITraceType | null> {
    const knex = KnexManager.getConnection();
    const traceType = await knex(this.tableName).where("id", id).first();

    return traceType ? this.mapToInterface(traceType) : null;
  }

  /**
   * Get trace type by UUID
   */
  async getByUuid(uuid: string): Promise<ITraceType | null> {
    const knex = KnexManager.getConnection();
    const traceType = await knex(this.tableName).where("uuid", uuid).first();

    return traceType ? this.mapToInterface(traceType) : null;
  }

  /**
   * Update trace type by ID
   */
  async update(id: number, item: Partial<ITraceType>): Promise<ITraceType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [traceType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return traceType ? this.mapToInterface(traceType) : null;
  }

  /**
   * Delete trace type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all trace types with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<ITraceType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [traceTypes, totalResult] = await Promise.all([
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
      data: traceTypes.map((traceType) => this.mapToInterface(traceType)),
      page,
      limit,
      count: traceTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all trace types with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<ITraceType>> {
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
    const [traceTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: traceTypes.map((traceType) => this.mapToInterface(traceType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: traceTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ITraceType {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
