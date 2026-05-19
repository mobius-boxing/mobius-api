import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IPaperType } from "../../interfaces/paper-type/paper-type.interfaces";
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

// companyId is intentionally absent — handled separately via a join in getAllWithFilters
// because the client sends a UUID, not a numeric id.
const PAPER_TYPE_FILTERS: FilterConfigs = {
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

const PAPER_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const PAPER_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "paper_types",
  {
    filters: PAPER_TYPE_FILTERS,
    sorting: PAPER_TYPE_SORTING,
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

export class PaperTypeDAO implements IBaseDAO<IPaperType> {
  private tableName = "paper_types";
  private queryConfig = PAPER_TYPE_QUERY_CONFIG;

  async create(item: IPaperType): Promise<IPaperType> {
    const knex = KnexManager.getConnection();
    const [paperType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
      })
      .returning("*");

    return this.mapToInterface(paperType);
  }

  async getById(id: number): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const paperType = await knex(this.tableName).where("id", id).first();

    return paperType ? this.mapToInterface(paperType) : null;
  }

  async getByUuid(uuid: string): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const paperType = await knex(this.tableName).where("uuid", uuid).first();

    return paperType ? this.mapToInterface(paperType) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

  async update(
    id: number,
    item: Partial<IPaperType>,
  ): Promise<IPaperType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;

    updateData.updatedAt = knex.fn.now();

    const [paperType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return paperType ? this.mapToInterface(paperType) : null;
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
  ): Promise<IDataPaginator<IPaperType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [paperTypes, totalResult] = await Promise.all([
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
      data: paperTypes.map((paperType) => this.mapToInterface(paperType)),
      page,
      limit,
      count: paperTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IPaperType>> {
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

    const [paperTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: paperTypes.map((paperType) => this.mapToInterface(paperType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: paperTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IPaperType {
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
