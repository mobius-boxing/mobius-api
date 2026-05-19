import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IFluteType } from "../../interfaces/flute-type/flute-type.interfaces";
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
const FLUTE_TYPE_FILTERS: FilterConfigs = {
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

const FLUTE_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  fluteFactor: { column: "fluteFactor" },
  length: { column: "length" },
  width: { column: "width" },
  height: { column: "height" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const FLUTE_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "flute_types",
  {
    filters: FLUTE_TYPE_FILTERS,
    sorting: FLUTE_TYPE_SORTING,
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

export class FluteTypeDAO implements IBaseDAO<IFluteType> {
  private tableName = "flute_types";
  private queryConfig = FLUTE_TYPE_QUERY_CONFIG;

  async create(item: IFluteType): Promise<IFluteType> {
    const knex = KnexManager.getConnection();
    const [fluteType] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        description: item.description,
        fluteFactor: item.fluteFactor,
        length: item.length,
        width: item.width,
        height: item.height,
      })
      .returning("*");

    return this.mapToInterface(fluteType);
  }

  async getById(id: number): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const fluteType = await knex(this.tableName).where("id", id).first();

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  async getByUuid(uuid: string): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const fluteType = await knex(this.tableName).where("uuid", uuid).first();

    return fluteType ? this.mapToInterface(fluteType) : null;
  }

  async update(
    id: number,
    item: Partial<IFluteType>,
  ): Promise<IFluteType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;
    if (item.fluteFactor !== undefined)
      updateData.fluteFactor = item.fluteFactor;
    if (item.length !== undefined) updateData.length = item.length;
    if (item.width !== undefined) updateData.width = item.width;
    if (item.height !== undefined) updateData.height = item.height;

    updateData.updatedAt = knex.fn.now();

    const [fluteType] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return fluteType ? this.mapToInterface(fluteType) : null;
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
  ): Promise<IDataPaginator<IFluteType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [fluteTypes, totalResult] = await Promise.all([
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
      data: fluteTypes.map((fluteType) => this.mapToInterface(fluteType)),
      page,
      limit,
      count: fluteTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IFluteType>> {
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

    const [fluteTypes, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: fluteTypes.map((fluteType) => this.mapToInterface(fluteType)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: fluteTypes.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IFluteType {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      fluteFactor: record.fluteFactor
        ? parseFloat(record.fluteFactor)
        : undefined,
      length: record.length ? parseFloat(record.length) : undefined,
      width: record.width ? parseFloat(record.width) : undefined,
      height: record.height ? parseFloat(record.height) : undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
