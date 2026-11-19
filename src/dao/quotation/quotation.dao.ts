import { Request } from "express";
import type { Knex } from "knex";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  IQuotation,
  IQuotationRow,
  IQuotationWrite,
  QUOTATION_STATUSES,
} from "../../interfaces/quotation/quotation.interfaces";
import { toNumberOut } from "../../utils/numbers";
import {
  buildCountQuery,
  buildQuery,
  createQueryConfig,
  parseQueryParams,
  type FilterConfigs,
  type ParsedQuery,
  type QueryBuilderConfig,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { applyCompanyScope } from "../../utils/daoScope";
import {
  assertUuidParam,
  FilterValidationError,
  parseEnumParam,
  parseTriStateParam,
} from "../../utils/query-params";
import { CoreClient } from "../../services/core-client.service";
import { CodeGeneratorService } from "../../services/code-generator.service";
import { OrderDeliveryService } from "../../services/order-delivery.service";
import { IDeliveryRow } from "../../interfaces/order-delivery/order-delivery.interfaces";

/** `code_sequences.scope` for the quotation counter (D-8). */
export const QUOTATION_SCOPE = "quotation";

const TABLE = "quotations";

const QUOTATION_FILTERS: FilterConfigs = {
  status: { column: "status", operator: "=" },
};

const QUOTATION_SORTING: SortConfigs = {
  number: { column: "number" },
  createdAt: { column: "createdAt" },
  deliveryDate: { column: "deliveryDate" },
  quantity: { column: "quantity" },
  price: { column: "price" },
  status: { column: "status" },
  // Joined sorts are valid on the data query only; the count query has no sort.
  customerName: { table: "cust", column: "name", natural: true },
  productCode: { table: "prod", column: "code", natural: true },
};

const QUOTATION_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(TABLE, {
  filters: QUOTATION_FILTERS,
  sorting: QUOTATION_SORTING,
  defaultSort: { column: "number", order: "desc" },
});

const LIST_PARAMS = [
  "page",
  "limit",
  "sortBy",
  "sortOrder",
  "search",
  "status",
  "approved",
  "ordered",
  "customerUuid",
  "productUuid",
  // A superAdmin names the company to operate as; regular users' value is ignored.
  "companyId",
] as const;

/**
 * L-007: a query parameter or `sortBy` the endpoint does not honour is a 400,
 * never silently dropped by the query builder. Shared by the new list DAOs.
 */
export function rejectUnknownListParams(
  req: Request,
  allowed: readonly string[],
  sortKeys: readonly string[],
): void {
  for (const key of Object.keys(req.query)) {
    if (!allowed.includes(key)) {
      throw new FilterValidationError(`Unsupported query parameter: ${key}`);
    }
  }
  const sortBy = req.query.sortBy;
  if (
    typeof sortBy === "string" &&
    sortBy !== "" &&
    !sortKeys.includes(sortBy)
  ) {
    throw new FilterValidationError(
      `Cannot sort by "${sortBy}": use one of ${sortKeys.join(", ")}`,
    );
  }
}

const SCALAR_COLUMNS = [
  "quantity",
  "price",
  "deliveryDate",
  "salesUserId",
  "notes",
  "status",
] as const;

export class QuotationDAO {
  private codeGenerator = new CodeGeneratorService();
  private deliveries = new OrderDeliveryService();

  /** Drawn before the insert (D-8): gaps are harmless, the unique index is the backstop. */
  nextNumber(companyId: number): Promise<number> {
    return this.codeGenerator.nextValue(companyId, QUOTATION_SCOPE);
  }

  private selectWithJoins(knex: Knex) {
    return knex(TABLE)
      .select(
        `${TABLE}.*`,
        knex.raw(
          `(${TABLE}."price" * ${TABLE}."quantity")::numeric(18,4) as "priceTotal"`,
        ),
        knex.raw(
          `jsonb_build_object('uuid', cust.uuid, 'name', cust.name) as "customer"`,
        ),
        knex.raw(
          `jsonb_build_object('uuid', prod.uuid, 'code', prod.code, 'description', prod.description) as "product"`,
        ),
        knex.raw(
          `CASE WHEN so.id IS NOT NULL THEN jsonb_build_object('uuid', so.uuid, 'number', so.number) END as "salesOrder"`,
        ),
      )
      .join("customers as cust", `${TABLE}.customerId`, "cust.id")
      .join("products as prod", `${TABLE}.productId`, "prod.id")
      .leftJoin("sales_orders as so", `${TABLE}.salesOrderId`, "so.id");
  }

  async create(
    item: IQuotationWrite & { number: number; uuid: string },
    deliveries?: IDeliveryRow[],
  ): Promise<string> {
    return db("tenant").transaction(async (trx) => {
      const [row] = await trx(TABLE)
        .insert({
          uuid: item.uuid,
          companyId: item.companyId,
          number: item.number,
          customerId: item.customerId,
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          deliveryDate: item.deliveryDate ?? null,
          salesUserId: item.salesUserId ?? null,
          notes: item.notes ?? null,
          status: item.status ?? "draft",
          createdByUser: item.createdByUser ?? null,
        })
        .returning(["id", "uuid"]);
      if (deliveries !== undefined) {
        await this.deliveries.replaceTrx(
          trx,
          { column: "quotationId", id: row.id },
          item.companyId!,
          deliveries,
        );
      }
      return row.uuid as string;
    });
  }

  async getByUuid(uuid: string, companyId: number): Promise<IQuotation | null> {
    const query = this.selectWithJoins(db("tenant")).where(
      `${TABLE}.uuid`,
      uuid,
    );
    applyCompanyScope(query, TABLE, companyId);
    const row = await query.first();
    if (!row) return null;
    const [mapped] = await this.mapRows([row]);
    return mapped;
  }

  /** The stored row with its numeric ids, company-scoped — for controller logic only. */
  async getRowByUuid(
    uuid: string,
    companyId: number,
    trx?: Knex.Transaction,
  ): Promise<IQuotationRow | null> {
    const query = (trx ?? db("tenant"))(TABLE).where(`${TABLE}.uuid`, uuid);
    applyCompanyScope(query, TABLE, companyId);
    const row = await query.first();
    if (!row) return null;
    return {
      ...row,
      quantity: Number(row.quantity),
      price: Number(row.price),
    };
  }

  async update(
    id: number,
    patch: IQuotationWrite,
    deliveries?: { companyId: number; rows: IDeliveryRow[] },
  ): Promise<void> {
    await db("tenant").transaction(async (trx) => {
      const data: Record<string, unknown> = {};
      for (const key of SCALAR_COLUMNS) {
        if (patch[key] !== undefined) data[key] = patch[key];
      }
      data.updatedAt = trx.fn.now();
      await trx(TABLE).where("id", id).update(data);
      if (deliveries) {
        await this.deliveries.replaceTrx(
          trx,
          { column: "quotationId", id },
          deliveries.companyId,
          deliveries.rows,
        );
      }
    });
  }

  async setApproval(
    id: number,
    approved: boolean,
    username: string | null,
  ): Promise<void> {
    const knex = db("tenant");
    await knex(TABLE)
      .where("id", id)
      .update({
        approvedAt: approved ? knex.fn.now() : null,
        approvedByUser: approved ? username : null,
        updatedAt: knex.fn.now(),
      });
  }

  async delete(id: number): Promise<boolean> {
    return (await db("tenant")(TABLE).where("id", id).delete()) > 0;
  }

  /** Resolves both references inside the company; `null` names the one that is missing. */
  async resolveReferences(
    companyId: number,
    customerUuid: string,
    productUuid: string,
  ): Promise<
    | { ok: true; customerId: number; productId: number }
    | { ok: false; missing: "customer" | "product" | "pairing" }
  > {
    const knex = db("tenant");
    const customer = await knex("customers")
      .where({ uuid: customerUuid, companyId })
      .select("id")
      .first();
    if (!customer) return { ok: false, missing: "customer" };
    const product = await knex("products")
      .where({ uuid: productUuid, companyId })
      .select("id", "customerId")
      .first();
    if (!product) return { ok: false, missing: "product" };
    if (product.customerId !== customer.id)
      return { ok: false, missing: "pairing" };
    return { ok: true, customerId: customer.id, productId: product.id };
  }

  /** Generate-order retry (D-27): the linked order and whether it already has production orders. */
  async getLinkedOrderState(salesOrderId: number): Promise<{
    uuid: string;
    number: string;
    hasProductionOrders: boolean;
  } | null> {
    const knex = db("tenant");
    const order = await knex("sales_orders")
      .where("id", salesOrderId)
      .select("uuid", "number", "orderDataId")
      .first();
    if (!order) return null;
    const generated = order.orderDataId
      ? await knex("production_orders")
          .where("orderDataId", order.orderDataId)
          .count("* as count")
          .first()
      : null;
    return {
      uuid: order.uuid,
      number: order.number,
      hasProductionOrders: Number(generated?.count ?? 0) > 0,
    };
  }

  async getCustomerSalesPersonId(
    customerId: number,
    companyId: number,
  ): Promise<number | null> {
    const row = await db("tenant")("customers")
      .where({ id: customerId, companyId })
      .select("salesPersonId")
      .first();
    return row?.salesPersonId ?? null;
  }

  /** Delivery location of the quotation's customer, inside the company. */
  async resolveDeliveryLocation(
    uuid: string,
    companyId: number,
  ): Promise<{ id: number; customerId: number } | null> {
    const row = await db("tenant")("delivery_locations")
      .where({ uuid, companyId })
      .select("id", "customerId")
      .first();
    return row ?? null;
  }

  async getAllWithFilters(
    req: Request,
    companyId: number,
  ): Promise<IDataPaginator<IQuotation>> {
    rejectUnknownListParams(req, LIST_PARAMS, Object.keys(QUOTATION_SORTING));
    const knex = db("tenant");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    delete parsedQuery.filters.companyId;

    parseEnumParam("status", parsedQuery.filters.status, QUOTATION_STATUSES);
    const approved = this.takeTriState(parsedQuery, "approved");
    const ordered = this.takeTriState(parsedQuery, "ordered");
    const customerId = await this.takeUuidFilter(
      parsedQuery,
      "customerUuid",
      "customers",
      companyId,
    );
    const productId = await this.takeUuidFilter(
      parsedQuery,
      "productUuid",
      "products",
      companyId,
    );
    const search = parsedQuery.search?.trim();
    delete parsedQuery.search;

    const applyExtra = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      applyCompanyScope(q, TABLE, companyId);
      if (customerId !== undefined) q.where(`${TABLE}.customerId`, customerId);
      if (productId !== undefined) q.where(`${TABLE}.productId`, productId);
      if (approved === true) q.whereNotNull(`${TABLE}.approvedAt`);
      else if (approved === false) q.whereNull(`${TABLE}.approvedAt`);
      if (ordered === true) q.whereNotNull(`${TABLE}.salesOrderId`);
      else if (ordered === false) q.whereNull(`${TABLE}.salesOrderId`);
      if (search) {
        const pattern = `%${search}%`;
        q.where((b) => {
          b.whereRaw(`${TABLE}."number"::text ILIKE ?`, [pattern])
            .orWhereExists(
              knex("customers")
                .select(knex.raw("1"))
                .whereRaw(`customers.id = ${TABLE}."customerId"`)
                .andWhere("customers.name", "ILIKE", pattern),
            )
            .orWhereExists(
              knex("products")
                .select(knex.raw("1"))
                .whereRaw(`products.id = ${TABLE}."productId"`)
                .andWhere((p) =>
                  p
                    .where("products.code", "ILIKE", pattern)
                    .orWhere("products.description", "ILIKE", pattern),
                ),
            );
        });
      }
      return q;
    };

    const dataQuery = applyExtra(this.selectWithJoins(knex));
    buildQuery(dataQuery, parsedQuery, QUOTATION_QUERY_CONFIG);
    const countQuery = applyExtra(knex(TABLE));
    buildCountQuery(countQuery, parsedQuery, QUOTATION_QUERY_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: await this.mapRows(rows),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  private takeTriState(
    parsedQuery: ParsedQuery,
    name: string,
  ): boolean | undefined {
    const value = parseTriStateParam(name, parsedQuery.filters[name]);
    delete parsedQuery.filters[name];
    return value;
  }

  /** `-1` (matches nothing) for a uuid outside the company — never an unfiltered 200. */
  private async takeUuidFilter(
    parsedQuery: ParsedQuery,
    name: string,
    table: "customers" | "products",
    companyId: number,
  ): Promise<number | undefined> {
    const uuid = assertUuidParam(name, parsedQuery.filters[name]);
    delete parsedQuery.filters[name];
    if (!uuid) return undefined;
    const row = await db("tenant")(table)
      .where({ uuid, companyId })
      .select("id")
      .first();
    return row?.id ?? -1;
  }

  private async mapRows(rows: any[]): Promise<IQuotation[]> {
    const ids = [
      ...new Set(
        rows.map((r) => r.salesUserId).filter((x): x is number => x != null),
      ),
    ];
    const users = new Map(
      (await CoreClient.usersByIds(ids)).map((u) => [u.id, u]),
    );
    const summaries = await this.deliveries.summaries(
      "quotationId",
      rows.map((r) => ({ id: r.id, quantity: Number(r.quantity) })),
    );
    return rows.map((row) => {
      const user = row.salesUserId != null ? users.get(row.salesUserId) : null;
      const quantity = Number(row.quantity);
      return {
        uuid: row.uuid,
        number: row.number,
        customer: row.customer,
        product: row.product,
        quantity,
        price: Number(row.price),
        priceTotal: toNumberOut(row.priceTotal) ?? 0,
        deliveryDate: row.deliveryDate ?? null,
        salesUser: user
          ? {
              uuid: user.uuid,
              name: `${user.firstName} ${user.lastName}`.trim(),
            }
          : null,
        notes: row.notes ?? null,
        status: row.status,
        approved: row.approvedAt != null,
        approvedAt: row.approvedAt ?? null,
        approvedByUser: row.approvedByUser ?? null,
        ordered: row.salesOrderId != null,
        salesOrder: row.salesOrder ?? null,
        createdByUser: row.createdByUser ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...summaries.get(row.id)!,
      };
    });
  }
}
