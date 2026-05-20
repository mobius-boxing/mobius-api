import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IStoreRoll } from "../../interfaces/store-roll/store-roll.interfaces";
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
const STORE_ROLL_FILTERS: FilterConfigs = {
  description: { column: "description", operator: "ILIKE" },
  isActive: {
    column: "isActive",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  uuid: { column: "uuid", operator: "=" },
};

const STORE_ROLL_SORTING: SortConfigs = {
  description: { column: "description" },
  minQuantity: { column: "minQuantity" },
  isActive: { column: "isActive" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const STORE_ROLL_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "store_rolls",
  {
    filters: STORE_ROLL_FILTERS,
    sorting: STORE_ROLL_SORTING,
    search: { columns: ["description"], operator: "ILIKE" },
    defaultSort: { column: "createdAt", order: "desc" },
  },
);

export class StoreRollDAO implements IBaseDAO<IStoreRoll> {
  private tableName = "store_rolls";
  private queryConfig = STORE_ROLL_QUERY_CONFIG;

  async create(item: IStoreRoll): Promise<IStoreRoll> {
    const knex = KnexManager.getConnection();
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        description: item.description,
        minQuantity: item.minQuantity ?? 50,
        isActive: item.isActive ?? true,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IStoreRoll | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<IStoreRoll | null> {
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

  async update(
    id: number,
    item: Partial<IStoreRoll>,
  ): Promise<IStoreRoll | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.description !== undefined) updateData.description = item.description;
    if (item.minQuantity !== undefined) updateData.minQuantity = item.minQuantity;
    if (item.isActive !== undefined) updateData.isActive = item.isActive;

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

  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IStoreRoll>> {
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
      data: records.map((r) => this.mapToInterface(r)),
      page,
      limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IStoreRoll>> {
    const knex = KnexManager.getConnection();
    const parsedQuery: ParsedQuery = parseQueryParams(req);

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

    const [records, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: records.map((r) => this.mapToInterface(r)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IStoreRoll {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      description: record.description,
      minQuantity: record.minQuantity,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
