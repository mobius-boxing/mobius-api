import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperClass } from "../../interfaces/paper-class/paper-class.interfaces";
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
 * Paper Class filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const PAPER_CLASS_FILTERS: FilterConfigs = {
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
 * Paper Class sort configuration
 */
const PAPER_CLASS_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Paper Class query builder configuration
 */
const PAPER_CLASS_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "paper_classes",
  {
    filters: PAPER_CLASS_FILTERS,
    sorting: PAPER_CLASS_SORTING,
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

export class PaperClassDAO implements IBaseDAO<IPaperClass> {
  private tableName = "paper_classes";
  private queryConfig = PAPER_CLASS_QUERY_CONFIG;

  /**
   * Create a new paper class
   */
  async create(item: IPaperClass): Promise<IPaperClass> {
    const knex = KnexManager.getConnection();
    const [paperClass] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        name: item.name,
        papers: JSON.stringify(item.papers),
      })
      .returning("*");

    return this.mapToInterface(paperClass);
  }

  /**
   * Get paper class by ID
   */
  async getById(id: number): Promise<IPaperClass | null> {
    const knex = KnexManager.getConnection();
    const paperClass = await knex(this.tableName).where("id", id).first();

    return paperClass ? this.mapToInterface(paperClass) : null;
  }

  /**
   * Get paper class by UUID
   */
  async getByUuid(uuid: string): Promise<IPaperClass | null> {
    const knex = KnexManager.getConnection();
    const paperClass = await knex(this.tableName).where("uuid", uuid).first();

    return paperClass ? this.mapToInterface(paperClass) : null;
  }

  /**
   * Update paper class by ID
   */
  async update(
    id: number,
    item: Partial<IPaperClass>,
  ): Promise<IPaperClass | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.papers !== undefined)
      updateData.papers = JSON.stringify(item.papers);

    updateData.updatedAt = knex.fn.now();

    const [paperClass] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperClass ? this.mapToInterface(paperClass) : null;
  }

  /**
   * Delete paper class by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all paper classes with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IPaperClass>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [paperClasses, totalResult] = await Promise.all([
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
      data: paperClasses.map((paperClass) => this.mapToInterface(paperClass)),
      page,
      limit,
      count: paperClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all paper classes with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code: Filter by code (ILIKE)
   * - name: Filter by name (ILIKE)
   * - search: Full-text search on code, name (e.g., ?search=TEST)
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPaperClass>> {
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
    const [paperClasses, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperClasses.map((paperClass) => this.mapToInterface(paperClass)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: paperClasses.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): IPaperClass {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      name: record.name,
      papers:
        typeof record.papers === "string"
          ? JSON.parse(record.papers)
          : record.papers,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
