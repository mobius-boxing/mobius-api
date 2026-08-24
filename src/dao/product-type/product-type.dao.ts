import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IProductType } from "../../interfaces/product-type/product-type.interfaces";
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
const PRODUCT_TYPE_FILTERS: FilterConfigs = {
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

const PRODUCT_TYPE_SORTING: SortConfigs = {
  code: { column: "code" },
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const PRODUCT_TYPE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "product_types",
  {
    filters: PRODUCT_TYPE_FILTERS,
    sorting: PRODUCT_TYPE_SORTING,
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

export class ProductTypeDAO implements IBaseDAO<IProductType> {
  private tableName = "product_types";
  private queryConfig = PRODUCT_TYPE_QUERY_CONFIG;

  async create(item: IProductType): Promise<IProductType> {
    const knex = db("erp");
    const [record] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code,
        name: item.name,
      })
      .returning("*");

    return this.mapToInterface(record);
  }

  async getById(id: number): Promise<IProductType | null> {
    const knex = db("erp");
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProductType | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.*`).first();
    return record ? this.mapToInterface(record) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const record = await query.select(`${this.tableName}.id`).first();
    return record ? record.id : null;
  }

  async update(
    id: number,
    item: Partial<IProductType>,
  ): Promise<IProductType | null> {
    const knex = db("erp");
    const updateData: any = {};

    if (item.code !== undefined) updateData.code = item.code;
    if (item.name !== undefined) updateData.name = item.name;

    updateData.updatedAt = knex.fn.now();

    const [record] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return record ? this.mapToInterface(record) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IProductType>> {
    const knex = db("erp");
    const offset = (page - 1) * limit;

    const [records, totalResult] = await Promise.all([
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
      data: records.map((r) => this.mapToInterface(r)),
      page,
      limit,
      count: records.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getAllWithFilters(req: Request): Promise<IDataPaginator<IProductType>> {
    const knex = db("erp");
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

  private mapToInterface(record: any): IProductType {
    return {
      uuid: record.uuid,
      code: record.code,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
