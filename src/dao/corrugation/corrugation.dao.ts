import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICorrugation } from "../../interfaces/corrugation/corrugation.interfaces";
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
 * Corrugation filter configuration
 * Note: companyId is handled separately via join (expects UUID from frontend)
 */
const CORRUGATION_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  description: {
    column: "description",
    operator: "ILIKE",
  },
  corrugationClassId: {
    column: "corrugationClassId",
    operator: "=",
    transform: (value: string) => parseInt(value, 10),
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

/**
 * Corrugation sort configuration
 */
const CORRUGATION_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  theoreticalGrammage: { column: "theoreticalGrammage" },
  suggestedWidth: { column: "suggestedWidth" },
  caliper: { column: "caliper" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

/**
 * Corrugation query builder configuration
 */
const CORRUGATION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "corrugations",
  {
    filters: CORRUGATION_FILTERS,
    sorting: CORRUGATION_SORTING,
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

export class CorrugationDAO implements IBaseDAO<ICorrugation> {
  private tableName = "corrugations";
  private queryConfig = CORRUGATION_QUERY_CONFIG;

  /**
   * Create a new corrugation
   */
  async create(item: ICorrugation): Promise<ICorrugation> {
    const knex = KnexManager.getConnection();
    const [corrugation] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
        theoreticalGrammage: item.theoreticalGrammage,
        suggestedWidth: item.suggestedWidth,
        caliper: item.caliper,
        corrugationClassId: item.corrugationClassId,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(corrugation);
  }

  /**
   * Get corrugation by ID
   */
  async getById(id: number): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const corrugation = await knex(this.tableName).where("id", id).first();

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  /**
   * Get corrugation by UUID with related corrugation class
   */
  async getByUuid(uuid: string): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const corrugation = await knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`
          CASE
            WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
            ELSE NULL
          END as "corrugationClass"
        `),
      )
      .leftJoin(
        "corrugation_classes as cc",
        `${this.tableName}.corrugationClassId`,
        "cc.id",
      )
      .where(`${this.tableName}.uuid`, uuid)
      .first();

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  /**
   * Update corrugation by ID
   */
  async update(
    id: number,
    item: Partial<ICorrugation>,
  ): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.theoreticalGrammage !== undefined)
      updateData.theoreticalGrammage = item.theoreticalGrammage;
    if (item.suggestedWidth !== undefined)
      updateData.suggestedWidth = item.suggestedWidth;
    if (item.caliper !== undefined) updateData.caliper = item.caliper;
    if (item.corrugationClassId !== undefined)
      updateData.corrugationClassId = item.corrugationClassId;

    updateData.updatedAt = knex.fn.now();

    const [corrugation] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

  /**
   * Delete corrugation by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all corrugations with pagination
   * @deprecated Use getAllWithFilters for advanced querying
   */
  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<ICorrugation>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [corrugations, totalResult] = await Promise.all([
      knex(this.tableName)
        .select(
          `${this.tableName}.*`,
          knex.raw(`
            CASE
              WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
              ELSE NULL
            END as "corrugationClass"
          `),
        )
        .leftJoin(
          "corrugation_classes as cc",
          `${this.tableName}.corrugationClassId`,
          "cc.id",
        )
        .orderBy(`${this.tableName}.code`, "asc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: corrugations.map((item) => this.mapToInterface(item)),
      page,
      limit,
      count: corrugations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get all corrugations with advanced filtering, sorting, and search
   * Uses query builder for flexible querying
   *
   * Supported query params:
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code: Filter by code (ILIKE)
   * - description: Filter by description (ILIKE)
   * - corrugationClassId: Filter by corrugation class ID
   * - search: Full-text search on code, description (e.g., ?search=TEST)
   */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICorrugation>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Extract companyId (UUID) from filters - handle it separately via join
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    // Build main query with join for corrugation class
    const dataQuery = knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(`
          CASE
            WHEN cc.id IS NOT NULL THEN to_jsonb(cc)
            ELSE NULL
          END as "corrugationClass"
        `),
      )
      .leftJoin(
        "corrugation_classes as cc",
        `${this.tableName}.corrugationClassId`,
        "cc.id",
      );

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
    const [corrugations, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: corrugations.map((item) => this.mapToInterface(item)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: corrugations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * Map database record to interface
   * SECURITY: Never expose numeric IDs to frontend - only UUIDs
   * Foreign keys (corrugationClassId) are replaced with the related object containing UUID
   */
  private mapToInterface(record: any): ICorrugation {
    // Strip numeric ID from corrugationClass if present
    let corrugationClass = undefined;
    if (record.corrugationClass) {
      const { id, ...classWithoutId } = record.corrugationClass;
      corrugationClass = classWithoutId;
    }

    return {
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      theoreticalGrammage: record.theoreticalGrammage
        ? parseFloat(record.theoreticalGrammage)
        : undefined,
      suggestedWidth: record.suggestedWidth
        ? parseFloat(record.suggestedWidth)
        : undefined,
      caliper: record.caliper ? parseFloat(record.caliper) : undefined,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      // Include related object with UUID, not numeric foreign key
      corrugationClass,
    };
  }

  /**
   * Internal method to map with ID (for internal use only, never send to frontend)
   */
  private mapToInternalInterface(
    record: any,
  ): ICorrugation & { id: number; corrugationClassId?: number } {
    return {
      id: record.id,
      corrugationClassId: record.corrugationClassId,
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
