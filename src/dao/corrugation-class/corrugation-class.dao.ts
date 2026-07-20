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
import { applyCompanyUuidScope } from "../../utils/daoScope";
import { Request } from "express";

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
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

const CORRUGATION_CLASS_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

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

  async create(item: ICorrugationClass): Promise<ICorrugationClass> {
    const knex = KnexManager.getConnection();
    const [corrugationClass] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        description: item.description,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(corrugationClass);
  }

  async getById(id: number): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const corrugationClass = await knex(this.tableName).where("id", id).first();

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ICorrugationClass | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const corrugationClass = await query.select(`${this.tableName}.*`).first();

    return corrugationClass ? this.mapToInterface(corrugationClass) : null;
  }

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

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * @deprecated Use getAllWithFilters for advanced querying.
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

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<ICorrugationClass>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid rather than
    // letting the query builder treat it as a column filter.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);

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

  // SECURITY: numeric `id` is intentionally omitted; clients only ever see UUIDs.
  private mapToInterface(record: any): ICorrugationClass {
    return {
      uuid: record.uuid,
      code: record.code,
      description: record.description,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  // Server-internal mapping that retains numeric id. Never return this directly to clients.
  private mapToInternalInterface(
    record: any,
  ): ICorrugationClass & { id: number } {
    return {
      id: record.id,
      ...this.mapToInterface(record),
    };
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.id`).first();
    return record ? record.id : null;
  }
}
