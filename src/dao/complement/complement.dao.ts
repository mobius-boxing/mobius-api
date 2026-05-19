import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IComplement } from "../../interfaces/complement/complement.interfaces";
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
 * Complement filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const COMPLEMENT_FILTERS: FilterConfigs = {
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
 * Complement sort configuration
 */
const COMPLEMENT_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Complement query builder configuration
 */
const COMPLEMENT_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "complements",
  {
    filters: COMPLEMENT_FILTERS,
    sorting: COMPLEMENT_SORTING,
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

export class ComplementDAO implements IBaseDAO<IComplement> {
  private tableName = "complements";
  private queryConfig = COMPLEMENT_QUERY_CONFIG;

  /**
   * Create a new complement
   */
  async create(item: IComplement): Promise<IComplement> {
    const knex = KnexManager.getConnection();
    const [complement] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(complement);
  }

  /**
   * Get complement by ID
   */
  async getById(id: number): Promise<IComplement | null> {
    const knex = KnexManager.getConnection();
    const complement = await knex(this.tableName).where("id", id).first();

    return complement ? this.mapToInterface(complement) : null;
  }

  /**
   * Get complement by UUID
   */
  async getByUuid(uuid: string): Promise<IComplement | null> {
    const knex = KnexManager.getConnection();
    const complement = await knex(this.tableName).where("uuid", uuid).first();

    return complement ? this.mapToInterface(complement) : null;
  }

  /**
   * Update complement by ID
   */
  async update(id: number, item: Partial<IComplement>): Promise<IComplement | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined) updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [complement] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return complement ? this.mapToInterface(complement) : null;
  }

  /**
   * Delete complement by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all complements with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<IComplement>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [complements, totalResult] = await Promise.all([
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
      data: complements.map((complement) => this.mapToInterface(complement)),
      page,
      limit,
      count: complements.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all complements with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IComplement>> {
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
    const [complements, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: complements.map((complement) => this.mapToInterface(complement)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: complements.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IComplement {
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
