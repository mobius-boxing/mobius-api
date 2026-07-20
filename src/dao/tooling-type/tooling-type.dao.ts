import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IToolingType } from "../../interfaces/tooling-type/tooling-type.interfaces";
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

// companyId is handled separately via a join because the client sends a UUID, not a numeric id.
const TOOLING_TYPE_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  name: {
    column: "name",
    operator: "ILIKE",
  },
  automaticConsumption: {
    column: "automaticConsumption",
    operator: "=",
    transform: (value: string) => value === "true",
  },
};

const TOOLING_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const TOOLING_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "tooling_types",
  {
    filters: TOOLING_TYPE_FILTERS,
    sorting: TOOLING_TYPE_SORTING,
    search: {
      columns: ["code", "name", "description"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "code",
      order: "asc",
    },
  },
);

export class ToolingTypeDAO implements IBaseDAO<IToolingType> {
  private tableName = "tooling_types";
  private queryConfig = TOOLING_TYPE_QUERY_CONFIG;

  async create(item: IToolingType): Promise<IToolingType> {
    const knex = KnexManager.getConnection();
    const [toolingType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
        description: item.description,
        automaticConsumption: item.automaticConsumption ?? false,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(toolingType);
  }

  async getById(id: number): Promise<IToolingType | null> {
    const knex = KnexManager.getConnection();
    const toolingType = await knex(this.tableName).where("id", id).first();
    return toolingType ? this.mapToInterface(toolingType) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IToolingType | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const toolingType = await query.select(`${this.tableName}.*`).first();
    return toolingType ? this.mapToInterface(toolingType) : null;
  }

  async getIdByUuid(uuid: string, companyUuid?: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.id`).first();
    return record ? record.id : null;
  }

  async update(id: number, item: Partial<IToolingType>): Promise<IToolingType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.description !== undefined) updateData.description = item.description;
    if (item.automaticConsumption !== undefined) updateData.automaticConsumption = item.automaticConsumption;

    updateData.updatedAt = knex.fn.now();

    const [toolingType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return toolingType ? this.mapToInterface(toolingType) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAll(page: number, limit: number): Promise<IDataPaginator<IToolingType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [toolingTypes, totalResult] = await Promise.all([
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
      data: toolingTypes.map((item) => this.mapToInterface(item)),
      page,
      limit,
      count: toolingTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IToolingType>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
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

    const [toolingTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: toolingTypes.map((item) => this.mapToInterface(item)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: toolingTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IToolingType {
    return {
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      description: record.description,
      automaticConsumption: record.automaticConsumption,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
