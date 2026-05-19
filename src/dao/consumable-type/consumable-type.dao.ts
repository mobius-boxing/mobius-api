import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IConsumableType } from "../../interfaces/consumable-type/consumable-type.interfaces";
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
const CONSUMABLE_TYPE_FILTERS: FilterConfigs = {
  code: {
    column: "code",
    operator: "ILIKE",
  },
  name: {
    column: "name",
    operator: "ILIKE",
  },
  autoConsumption: {
    column: "autoConsumption",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  uuid: {
    column: "uuid",
    operator: "=",
  },
};

const CONSUMABLE_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const CONSUMABLE_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "consumable_types",
  {
    filters: CONSUMABLE_TYPE_FILTERS,
    sorting: CONSUMABLE_TYPE_SORTING,
    search: {
      columns: ["code", "name"],
      operator: "ILIKE",
    },
    defaultSort: {
      column: "createdAt",
      order: "desc",
    },
  }
);

export class ConsumableTypeDAO implements IBaseDAO<IConsumableType> {
  private tableName = "consumable_types";
  private queryConfig = CONSUMABLE_TYPE_QUERY_CONFIG;

  async create(item: IConsumableType): Promise<IConsumableType> {
    const knex = KnexManager.getConnection();
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        code: item.code,
        name: item.name,
        autoConsumption: item.autoConsumption ?? false,
        companyId: item.companyId,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IConsumableType | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<IConsumableType | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("uuid", uuid).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getIdByUuid(uuid: string): Promise<number | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName)
      .select("id")
      .where("uuid", uuid)
      .first();
    return record ? record.id : null;
  }

  async update(id: number, item: Partial<IConsumableType>): Promise<IConsumableType | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;
    if (item.autoConsumption !== undefined) updateData.autoConsumption = item.autoConsumption;

    updateData.updatedAt = knex.fn.now();

    const [record] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return record ? this.mapToInterface(record) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAll(page: number, limit: number): Promise<IDataPaginator<IConsumableType>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [records, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((record: any) => this.mapToInterface(record)),
      page,
      limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IConsumableType>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // Client sends a UUID for companyId; resolve via join against companies.uuid.
    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    const countQuery = knex(this.tableName);

    if (companyUuid) {
      dataQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
      countQuery
        .join("companies", `${this.tableName}.companyId`, "companies.id")
        .where("companies.uuid", companyUuid);
    }

    buildQuery(dataQuery, parsedQuery, this.queryConfig);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [records, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((record: any) => this.mapToInterface(record)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IConsumableType {
    return {
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      autoConsumption: record.autoConsumption,
      companyId: record.companyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
