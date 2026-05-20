import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IStoreBox } from "../../interfaces/store-box/store-box.interfaces";
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
const STORE_BOX_FILTERS: FilterConfigs = {
  description: { column: "description", operator: "ILIKE" },
  isActive: {
    column: "isActive",
    operator: "=",
    transform: (value: string) => value === "true",
  },
  uuid: { column: "uuid", operator: "=" },
};

const STORE_BOX_SORTING: SortConfigs = {
  description: { column: "description" },
  unitsPerPackage: { column: "unitsPerPackage" },
  unitsPerPallet: { column: "unitsPerPallet" },
  isActive: { column: "isActive" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const STORE_BOX_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "store_boxes",
  {
    filters: STORE_BOX_FILTERS,
    sorting: STORE_BOX_SORTING,
    search: { columns: ["description"], operator: "ILIKE" },
    defaultSort: { column: "createdAt", order: "desc" },
  },
);

export class StoreBoxDAO implements IBaseDAO<IStoreBox> {
  private tableName = "store_boxes";
  private queryConfig = STORE_BOX_QUERY_CONFIG;

  async create(item: IStoreBox): Promise<IStoreBox> {
    const knex = KnexManager.getConnection();
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        description: item.description,
        unitsPerPackage: item.unitsPerPackage,
        unitsPerPallet: item.unitsPerPallet,
        isActive: item.isActive ?? true,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IStoreBox | null> {
    const knex = KnexManager.getConnection();
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(uuid: string): Promise<IStoreBox | null> {
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

  async update(id: number, item: Partial<IStoreBox>): Promise<IStoreBox | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.description !== undefined) updateData.description = item.description;
    if (item.unitsPerPackage !== undefined)
      updateData.unitsPerPackage = item.unitsPerPackage;
    if (item.unitsPerPallet !== undefined)
      updateData.unitsPerPallet = item.unitsPerPallet;
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

  async getAll(page: number, limit: number): Promise<IDataPaginator<IStoreBox>> {
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

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IStoreBox>> {
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

  private mapToInterface(record: any): IStoreBox {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      description: record.description,
      unitsPerPackage: record.unitsPerPackage,
      unitsPerPallet: record.unitsPerPallet,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
