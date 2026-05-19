import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IGlueType } from "../../interfaces/glue-type/glue-type.interfaces";
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
 * Glue Type filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const GLUE_TYPE_FILTERS: FilterConfigs = {
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
 * Glue Type sort configuration
 */
const GLUE_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Glue Type query builder configuration
 */
const GLUE_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "glue_types",
  {
    filters: GLUE_TYPE_FILTERS,
    sorting: GLUE_TYPE_SORTING,
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

export class GlueTypeDAO implements IBaseDAO<IGlueType> {
  private tableName = "glue_types";
  private queryConfig = GLUE_TYPE_QUERY_CONFIG;

  /**
   * Create a new glue type
   */
  async create(item: IGlueType): Promise<IGlueType> {
    const knex = KnexManager.getConnection();
    const [glueType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(glueType);
  }

  /**
   * Get glue type by ID
   */
  async getById(id: number): Promise<IGlueType | null> {
    const knex = KnexManager.getConnection();
    const glueType = await knex(this.tableName).where("id", id).first();

    return glueType ? this.mapToInterface(glueType) : null;
  }

  /**
   * Get glue type by UUID
   */
  async getByUuid(uuid: string): Promise<IGlueType | null> {
    const knex = KnexManager.getConnection();
    const glueType = await knex(this.tableName).where("uuid", uuid).first();

    return glueType ? this.mapToInterface(glueType) : null;
  }

  /**
   * Update glue type by ID
   */
  async update(id: number, item: Partial<IGlueType>): Promise<IGlueType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [glueType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return glueType ? this.mapToInterface(glueType) : null;
  }

  /**
   * Delete glue type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all glue types with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IGlueType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [glueTypes, totalResult] = await Promise.all([
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
      data: glueTypes.map((glueType) => this.mapToInterface(glueType)),
      page,
      limit,
      count: glueTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all glue types with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IGlueType>> {
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
    const [glueTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: glueTypes.map((glueType) => this.mapToInterface(glueType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: glueTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IGlueType {
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
