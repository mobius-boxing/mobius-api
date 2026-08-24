import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IDeliveryZone } from "../../interfaces/delivery/delivery.interfaces";
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

const DELIVERY_ZONE_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  code: { column: "code", operator: "ILIKE" },
};

const DELIVERY_ZONE_SORTING: SortConfigs = {
  code: { column: "code" },
  description: { column: "description" },
  createdAt: { column: "createdAt" },
};

const DELIVERY_ZONE_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "delivery_zones",
  {
    filters: DELIVERY_ZONE_FILTERS,
    sorting: DELIVERY_ZONE_SORTING,
    search: { columns: ["code", "description"], operator: "ILIKE" },
    defaultSort: { column: "code", order: "asc" },
  },
);

export class DeliveryZoneDAO {
  private tableName = "delivery_zones";
  private queryConfig = DELIVERY_ZONE_QUERY_CONFIG;

  async create(item: IDeliveryZone): Promise<IDeliveryZone> {
    const knex = db("erp");
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        code: item.code ?? null,
        description: item.description ?? null,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IDeliveryZone | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.*`).first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const knex = db("erp");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(
    id: number,
    item: Partial<IDeliveryZone>,
  ): Promise<IDeliveryZone | null> {
    const knex = db("erp");
    const updateData: any = {};
    if (item.code !== undefined) updateData.code = item.code;
    if (item.description !== undefined)
      updateData.description = item.description;
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IDeliveryZone>> {
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

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row: any) => this.mapToInterface(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private mapToInterface(record: any): IDeliveryZone {
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      code: record.code,
      description: record.description,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
