import { Request } from "express";
import type { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IDeliveryLocation } from "../../interfaces/delivery/delivery.interfaces";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";
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
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";

const DELIVERY_LOCATION_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  address: { column: "address", operator: "ILIKE" },
  customerId: {
    column: "customerId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
  deliveryZoneId: {
    column: "deliveryZoneId",
    operator: "=",
    transform: (v: string) => parseInt(v, 10),
  },
};

const DELIVERY_LOCATION_SORTING: SortConfigs = {
  address: { column: "address" },
  createdAt: { column: "createdAt" },
};

const DELIVERY_LOCATION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "delivery_locations",
  {
    filters: DELIVERY_LOCATION_FILTERS,
    sorting: DELIVERY_LOCATION_SORTING,
    search: { columns: ["address", "externalSystemCode"], operator: "ILIKE" },
    defaultSort: { column: "createdAt", order: "asc" },
  },
);

export class DeliveryLocationDAO {
  private tableName = "delivery_locations";
  private queryConfig = DELIVERY_LOCATION_QUERY_CONFIG;

  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(
          `CASE WHEN dz.id IS NOT NULL THEN to_jsonb(dz) END as "deliveryZone"`,
        ),
        knex.raw(
          `CASE WHEN c.id IS NOT NULL THEN to_jsonb(c) END as "customer"`,
        ),
      )
      .leftJoin(
        "delivery_zones as dz",
        `${this.tableName}.deliveryZoneId`,
        "dz.id",
      )
      .leftJoin("customers as c", `${this.tableName}.customerId`, "c.id");
  }

  async create(item: IDeliveryLocation): Promise<IDeliveryLocation> {
    const knex = db("tenant");
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        customerId: item.customerId,
        address: item.address ?? null,
        schedule: item.schedule ?? null,
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
        externalSystemCode: item.externalSystemCode ?? null,
        deliveryZoneId: item.deliveryZoneId ?? null,
        isCustomerAddress: item.isCustomerAddress ?? false,
      })
      .returning("*");
    return (await this.getByUuid(row.uuid)) ?? this.mapToInterface(row);
  }

  /**
   * Keeps the customer's flagged row equal to `customers.address`
   * (customer-address-delivery I-1/I-2) inside the customer's own write
   * transaction, so a customer never commits without its address row. The
   * customer write is the ONLY writer of that row's address (D-5).
   */
  async syncCustomerAddressTrx(
    trx: Knex.Transaction,
    customer: Pick<ICustomer, "id" | "companyId" | "address">,
  ): Promise<void> {
    const address = customer.address?.trim();
    if (!customer.id || !address) return;

    const existing = await trx(this.tableName)
      .where({ customerId: customer.id, isCustomerAddress: true })
      .first();
    if (existing) {
      if (existing.address !== address) {
        await trx(this.tableName)
          .where("id", existing.id)
          .update({ address, updatedAt: trx.fn.now() });
      }
      return;
    }
    await trx(this.tableName).insert({
      uuid: uuidv4(),
      companyId: customer.companyId,
      customerId: customer.id,
      address,
      isCustomerAddress: true,
    });
  }

  async getById(id: number): Promise<IDeliveryLocation | null> {
    const knex = db("tenant");
    const row = await knex(this.tableName).where("id", id).first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<IDeliveryLocation | null> {
    const knex = db("tenant");
    const query = this.selectWithJoins(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    applyCompanyScope(query, this.tableName, companyId);
    const row = await query.first();
    return row ? { ...this.mapToInterface(row), id: row.id } : null;
  }

  async getIdByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<number | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId);
    const row = await query.select(`${this.tableName}.id`).first();
    return row?.id ?? null;
  }

  async update(
    id: number,
    item: Partial<IDeliveryLocation>,
  ): Promise<IDeliveryLocation | null> {
    const knex = db("tenant");
    const updateData: any = {};
    for (const key of [
      "address",
      "schedule",
      "latitude",
      "longitude",
      "externalSystemCode",
      "deliveryZoneId",
    ] as const) {
      if (item[key] !== undefined) updateData[key] = item[key];
    }
    updateData.updatedAt = knex.fn.now();
    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row
      ? ((await this.getByUuid(row.uuid)) ?? this.mapToInterface(row))
      : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("tenant");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IDeliveryLocation>> {
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyId = companyFilterScope(req);
    delete parsedQuery.filters.companyId;

    // customerUuid filter: resolve to the numeric customerId filter.
    const customerUuid = parsedQuery.filters.customerUuid as string | undefined;
    delete parsedQuery.filters.customerUuid;
    if (customerUuid) {
      const customer = await knex("customers")
        .where("uuid", customerUuid)
        .select("id")
        .first();
      parsedQuery.filters.customerId = String(customer?.id ?? -1);
    }

    const dataQuery = this.selectWithJoins(knex);
    applyCompanyScope(dataQuery, this.tableName, companyId);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    applyCompanyScope(countQuery, this.tableName, companyId);
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

  // SECURITY: uuid-only surface; nested objects stripped of numeric ids.
  private mapToInterface(record: any): IDeliveryLocation {
    const stripZone = (obj: any) => {
      if (!obj) return null;
      return { uuid: obj.uuid, code: obj.code, description: obj.description };
    };
    const stripCustomer = (obj: any) => {
      if (!obj) return null;
      return { uuid: obj.uuid, name: obj.name };
    };
    return {
      uuid: record.uuid,
      companyId: record.companyId,
      address: record.address,
      schedule: record.schedule,
      latitude: record.latitude != null ? parseFloat(record.latitude) : null,
      longitude: record.longitude != null ? parseFloat(record.longitude) : null,
      externalSystemCode: record.externalSystemCode,
      isCustomerAddress: record.isCustomerAddress === true,
      legacyId: record.legacyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deliveryZone: stripZone(record.deliveryZone),
      customer: stripCustomer(record.customer),
    };
  }
}
