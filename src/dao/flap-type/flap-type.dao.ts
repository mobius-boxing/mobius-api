import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IFlapType } from "../../interfaces/flap-type/flap-type.interfaces";
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
 * Flap Type filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const FLAP_TYPE_FILTERS: FilterConfigs = {
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
 * Flap Type sort configuration
 */
const FLAP_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Flap Type query builder configuration
 */
const FLAP_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "flap_types",
  {
    filters: FLAP_TYPE_FILTERS,
    sorting: FLAP_TYPE_SORTING,
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

export class FlapTypeDAO implements IBaseDAO<IFlapType> {
  private tableName = "flap_types";
  private queryConfig = FLAP_TYPE_QUERY_CONFIG;

  /**
   * Create a new flap type
   */
  async create(item: IFlapType): Promise<IFlapType> {
    const knex = KnexManager.getConnection();
    const [flapType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(flapType);
  }

  /**
   * Get flap type by ID
   */
  async getById(id: number): Promise<IFlapType | null> {
    const knex = KnexManager.getConnection();
    const flapType = await knex(this.tableName).where("id", id).first();

    return flapType ? this.mapToInterface(flapType) : null;
  }

  /**
   * Get flap type by UUID
   */
  async getByUuid(uuid: string): Promise<IFlapType | null> {
    const knex = KnexManager.getConnection();
    const flapType = await knex(this.tableName).where("uuid", uuid).first();

    return flapType ? this.mapToInterface(flapType) : null;
  }

  /**
   * Update flap type by ID
   */
  async update(id: number, item: Partial<IFlapType>): Promise<IFlapType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [flapType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return flapType ? this.mapToInterface(flapType) : null;
  }

  /**
   * Delete flap type by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all flap types with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IFlapType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [flapTypes, totalResult] = await Promise.all([
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
      data: flapTypes.map((flapType) => this.mapToInterface(flapType)),
      page,
      limit,
      count: flapTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all flap types with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IFlapType>> {
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
    const [flapTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: flapTypes.map((flapType) => this.mapToInterface(flapType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: flapTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IFlapType {
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
