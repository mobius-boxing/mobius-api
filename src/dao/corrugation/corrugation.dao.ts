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

// companyId is handled separately via a join because the client sends a UUID, not a numeric id.
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

const CORRUGATION_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  theoreticalGrammage: { column: "theoreticalGrammage" },
  suggestedWidth: { column: "suggestedWidth" },
  caliper: { column: "caliper" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

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

  async getById(id: number): Promise<ICorrugation | null> {
    const knex = KnexManager.getConnection();
    const corrugation = await knex(this.tableName).where("id", id).first();

    return corrugation ? this.mapToInterface(corrugation) : null;
  }

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

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /** @deprecated Use getAllWithFilters for advanced querying */
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<ICorrugation>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

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

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);

    if (companyUuid) {
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

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

  // SECURITY: never expose numeric ids; foreign keys are returned as nested objects keyed by UUID.
  private mapToInterface(record: any): ICorrugation {
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
      corrugationClass,
    };
  }

  private mapToInternalInterface(
    record: any,
  ): ICorrugation & { id: number; corrugationClassId?: number } {
    return {
      id: record.id,
      corrugationClassId: record.corrugationClassId,
      ...this.mapToInterface(record),
    };
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }
}
