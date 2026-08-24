import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  deriveSalesOrderStatus,
  IAssociatedProductionOrder,
  IOrderData,
  ISalesOrder,
  ISalesOrderRef,
  ISalesOrderWrite,
} from "../../interfaces/sales-order/sales-order.interfaces";
import { OrderApprovalMachine } from "../../interfaces/sales-order/sales-order-approval.interfaces";
import { toNumberOut } from "../../utils/numbers";
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
import {
  assertUuidParam,
  parseDateParam,
  parseTriStateParam,
} from "../../utils/query-params";
import {
  CodeGeneratorService,
  CODE_SCOPES,
} from "../../services/code-generator.service";
import { OrderDataDAO } from "../order-data/order-data.dao";

/** An upper bound with no time part, e.g. `2026-03-31`. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The INCLUSIVE upper bound of a delivery-date range. A date-only value parses
 * as UTC midnight, so `<=` would drop every pedido of that same day carrying a
 * time (15:00 is not "on or before" 00:00) — it is pushed to the last instant
 * of the day instead. A value that carries a time is honoured exactly.
 */
function upperDateBound(raw: string): Date {
  const parsed = new Date(raw);
  if (DATE_ONLY_PATTERN.test(String(raw).trim())) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed;
}

// companyId is handled via a join (the client sends a UUID); customerUuid /
// productUuid / partUuid / sheetSupplyUuid / salesUserUuid are resolved to
// numeric ids in getAllWithFilters and applied inside `applyExtra` — NOT as
// filter keys here, so no numeric internal id is reachable as a query param on
// this uuid-only API (create deviation 1, the shape product.dao.ts uses).
// `status` is NOT a filter here: it is derived, not a column, and the worklist
// page owns it (non-goal 8).
//
// INVARIANT (AC-18): every key here names a column of `sales_orders` itself.
// `buildCountQuery` runs on the bare table with no joins, so a filter, sort or
// search key pointing at a joined table would 42703 the count query.
export const SALES_ORDER_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  number: { column: "number", operator: "ILIKE" },
  purchaseOrder: { column: "purchaseOrder", operator: "ILIKE" },
  // Both bounds are INCLUSIVE (PedidoRepository.cs:102-109).
  deliveryDateFrom: {
    column: "deliveryDate",
    operator: ">=",
    transform: (v: string) => new Date(v),
  },
  deliveryDateTo: {
    column: "deliveryDate",
    operator: "<=",
    transform: (v: string) => upperDateBound(v),
  },
};

export const SALES_ORDER_SORTING: SortConfigs = {
  number: { column: "number" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
  deliveryDate: { column: "deliveryDate" },
  quantity: { column: "quantity" },
  price: { column: "price" },
  purchaseOrder: { column: "purchaseOrder" },
  supplierCode: { column: "supplierCode" },
};

export const SALES_ORDER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "sales_orders",
  {
    filters: SALES_ORDER_FILTERS,
    sorting: SALES_ORDER_SORTING,
    search: {
      columns: ["number", "purchaseOrder", "supplierCode"],
      operator: "ILIKE",
    },
    // D-8: Procusto's grid is `OrderByDescending(c => c.Id)`
    // (PedidoRepository.cs:110). `id` is never offered as a `sortBy` value and
    // never leaves the API — it is the default ordering only.
    defaultSort: { column: "id", order: "desc" },
  },
);

/** Columns a create/update payload may write on sales_orders. */
const SCALAR_COLUMNS = [
  "quantity",
  "price",
  "paid",
  "deliveryDate",
  "purchaseOrder",
  "stockOrder",
  "specialOrder",
  "needsAdvanceInvoice",
  "invoiceSent",
  "salesSector",
  "balancePercentage",
  "supplierCode",
  "salesUserId",
  "legacyId",
] as const;

/** The nine lifecycle pairs — read-only here; no endpoint in this feature writes them. */
const LIFECYCLE_COLUMNS = [
  "fulfilledAt",
  "fulfilledBy",
  "fulfillmentCancelledAt",
  "fulfillmentCancelledBy",
  "commercialApprovedAt",
  "commercialApprovedBy",
  "commercialCancelledAt",
  "commercialCancelledBy",
  "financialApprovedAt",
  "financialApprovedBy",
  "financialCancelledAt",
  "financialCancelledBy",
  "voidedAt",
  "voidedBy",
  "voidCancelledAt",
  "voidCancelledBy",
  "creditLimitOverrideAt",
  "creditLimitOverrideBy",
] as const;

/**
 * Approval machine → its timestamp+user column pairs (spec §State-transition
 * rules, Pedido.cs:213-248,270-276). Outside the class, beside the other
 * configs. Fulfillment and void have pairs of their own; they are NOT here —
 * this endpoint never reads or writes them (R-3).
 */
const ORDER_MACHINE_COLUMNS: Record<
  OrderApprovalMachine,
  {
    approvedAt: string;
    approvedBy: string;
    cancelledAt: string;
    cancelledBy: string;
  }
> = {
  commercial: {
    approvedAt: "commercialApprovedAt",
    approvedBy: "commercialApprovedBy",
    cancelledAt: "commercialCancelledAt",
    cancelledBy: "commercialCancelledBy",
  },
  financial: {
    approvedAt: "financialApprovedAt",
    approvedBy: "financialApprovedBy",
    cancelledAt: "financialCancelledAt",
    cancelledBy: "financialCancelledBy",
  },
};

export class SalesOrderDAO {
  private tableName = "sales_orders";
  private queryConfig = SALES_ORDER_QUERY_CONFIG;
  private codeGenerator = new CodeGeneratorService();
  private orderDataDAO = new OrderDataDAO();

  // ── Reads ────────────────────────────────────────────────────────────────
  private selectWithJoins(knex: any) {
    return (
      knex(this.tableName)
        .select(
          `${this.tableName}.*`,
          // PrecioTotal (EdicionDatosPedido.cs:509-519): unit price × quantity,
          // NULL when no price is set. Computed in SQL, never stored (OQ-2).
          knex.raw(
            `("sales_orders"."price" * "sales_orders"."quantity")::numeric(18,4) as "priceTotal"`,
          ),
          knex.raw(
            `CASE WHEN cust.id IS NOT NULL THEN to_jsonb(cust) END as "customer"`,
          ),
          knex.raw(
            `CASE WHEN prod.id IS NOT NULL THEN to_jsonb(prod) END as "product"`,
          ),
          knex.raw(
            `CASE WHEN su.id IS NOT NULL THEN to_jsonb(su) END as "salesUser"`,
          ),
          knex.raw(
            `CASE WHEN od.id IS NOT NULL THEN to_jsonb(od) END as "orderData"`,
          ),
          knex.raw(
            `CASE WHEN dl.id IS NOT NULL THEN to_jsonb(dl) END as "deliveryLocation"`,
          ),
          // The two other TPH subtypes, for the item description (column 6).
          knex.raw(
            `CASE WHEN prt.id IS NOT NULL THEN to_jsonb(prt) END as "part"`,
          ),
          knex.raw(
            `CASE WHEN psh.id IS NOT NULL THEN to_jsonb(psh) END as "sheetSupply"`,
          ),
        )
        .leftJoin(
          "customers as cust",
          `${this.tableName}.customerId`,
          "cust.id",
        )
        .leftJoin("products as prod", `${this.tableName}.productId`, "prod.id")
        // TODO(core-cutover): users is core-owned; this leftJoin 42P01s once the
        // DBs split. Repo-wide pattern (the registry guard cannot see joins), so
        // it is flagged here rather than refactored in this feature.
        .leftJoin("users as su", `${this.tableName}.salesUserId`, "su.id")
        .leftJoin("order_data as od", `${this.tableName}.orderDataId`, "od.id")
        .leftJoin("delivery_locations as dl", "od.deliveryLocationId", "dl.id")
        // JOINS LIVE ON THE DATA QUERY ONLY (AC-18): the count query runs on the
        // bare table, so no filter, sort or search key may name these tables.
        .leftJoin("parts as prt", `${this.tableName}.partId`, "prt.id")
        .leftJoin(
          "paper_sheets as psh",
          `${this.tableName}.sheetSupplyId`,
          "psh.id",
        )
    );
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ISalesOrder | null> {
    const knex = db("erp");
    const query = this.selectWithJoins(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.first();
    // L-005: re-attach the numeric id explicitly — mapToInterface strips it,
    // and callers that guard on `existing.id` would 404 forever otherwise.
    // `partId` rides along for the same reason (the PUT immutability check on
    // a pedido de parte); it is a number, so sanitizeResponse strips it on the
    // way out, and the spread is conditional so a pedido de producto never
    // gains a `partId: null` key its callers would see.
    return row
      ? {
          ...this.mapToInterface(row),
          id: row.id,
          ...(row.partId ? { partId: row.partId } : {}),
        }
      : null;
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

  // ── Create (one transaction: order_data first, then the order) ────────────
  /**
   * Numbering is `CodeGeneratorService` under the `sales-order` scope: an
   * 8-digit zero-padded counter, format-identical to Procusto's `{0:00000000}`
   * (D-5). No table scan and no retry loop.
   *
   * R3: `nextValue` is a single atomic upsert on its OWN connection, so it does
   * not join this transaction — a rolled-back create burns a number. That is
   * deliberate sequence semantics (divergence D7 of the service): gapless
   * numbering would need a lock held for the whole request.
   */
  async create(item: ISalesOrderWrite): Promise<ISalesOrder> {
    const knex = db("erp");
    const number = await this.codeGenerator.next(
      item.companyId!,
      CODE_SCOPES.salesOrder,
    );

    const created = await knex.transaction(async (trx) => {
      const orderDataRow = await this.orderDataDAO.createTrx(trx, {
        companyId: item.companyId,
        customerId: item.customerId,
        number,
        // Editar.cs:164 — the pedido's quantity is copied to DatosPedido.
        quantity: item.quantity ?? 0,
        ...item.orderDataInput,
      });

      const insertData: Record<string, unknown> = {
        uuid: item.uuid ?? uuidv4(),
        companyId: item.companyId,
        customerId: item.customerId,
        // TPH: exactly one discriminator, enforced by the table's CHECK
        // (create_sales_orders_tables.ts:208-209) and decided by the
        // controller — `PedidoMapper.cs:147-165`.
        productId: item.productId ?? null,
        partId: item.partId ?? null,
        orderDataId: orderDataRow.id,
        number,
        // Editar.cs:44-49 — Creacion / CreacionUsuario are system-set.
        createdBy: item.createdByUsername ?? null,
      };
      for (const key of SCALAR_COLUMNS) {
        if (item[key] !== undefined) insertData[key] = item[key];
      }

      const [row] = await trx(this.tableName).insert(insertData).returning("*");
      return row;
    });

    return (await this.getByUuid(created.uuid)) ?? this.mapToInterface(created);
  }

  // ── Update (both rows stay in sync, one transaction) ──────────────────────
  async update(
    id: number,
    item: Partial<ISalesOrderWrite>,
  ): Promise<ISalesOrder | null> {
    const knex = db("erp");
    const updated = await knex.transaction(async (trx) => {
      const existing = await trx(this.tableName)
        .where("id", id)
        .select("id", "uuid", "number", "orderDataId")
        .first();
      if (!existing) return null;

      const updateData: Record<string, unknown> = {};
      for (const key of SCALAR_COLUMNS) {
        if (item[key] !== undefined) updateData[key] = item[key];
      }
      updateData.updatedAt = trx.fn.now();
      await trx(this.tableName).where("id", id).update(updateData);

      if (existing.orderDataId) {
        // EdicionDatosPedido.cs:271-272 + Editar.cs:164: number and quantity
        // are mirrored onto DatosPedido on every save.
        await this.orderDataDAO.updateTrx(trx, existing.orderDataId, {
          number: existing.number,
          ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
          ...item.orderDataInput,
        });
      }

      return existing;
    });

    return updated ? await this.getByUuid(updated.uuid) : null;
  }

  // ── Delete (both rows, one transaction — no cascade does this, L-006) ─────
  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    return knex.transaction(async (trx) => {
      const existing = await trx(this.tableName)
        .where("id", id)
        .select("orderDataId")
        .first();
      if (!existing) return false;

      const deleted = await trx(this.tableName).where("id", id).delete();
      if (deleted > 0 && existing.orderDataId) {
        // The order row goes first: order_data is the FK target (RESTRICT).
        await this.orderDataDAO.deleteTrx(trx, existing.orderDataId);
      }
      return deleted > 0;
    });
  }

  // ── Approvals (pair semantics + append-only event log) ───────────────────
  /**
   * Stamp ONE machine's pair and append one history row, in one transaction
   * (R-7). Procusto's four methods are unconditional stamps
   * (Pedido.cs:213-248,270-276): no precondition on the other machine (R-1),
   * no state guard on `fulfilledAt`/`voidedAt` (R-3), no 409 on a re-stamp
   * (R-4), and the credit-override pair is never read or written (R-5, D-7).
   *
   * The update object carries exactly FIVE keys — the machine's four columns
   * plus `updatedAt` — which is what makes the "no side effects" AC provable.
   * The company check already happened in the controller (L-009), so the only
   * predicate here is the numeric id.
   */
  async setApproval(
    id: number,
    machine: OrderApprovalMachine,
    action: "approve" | "cancel",
    username: string,
  ): Promise<ISalesOrder | null> {
    const knex = db("erp");
    const cols = ORDER_MACHINE_COLUMNS[machine];
    const updateData: Record<string, unknown> = { updatedAt: knex.fn.now() };
    if (action === "approve") {
      updateData[cols.approvedAt] = knex.fn.now();
      updateData[cols.approvedBy] = username;
      updateData[cols.cancelledAt] = null;
      updateData[cols.cancelledBy] = null;
    } else {
      updateData[cols.cancelledAt] = knex.fn.now();
      updateData[cols.cancelledBy] = username;
      updateData[cols.approvedAt] = null;
      updateData[cols.approvedBy] = null;
    }

    const [row] = await knex.transaction(async (trx) => {
      const updated = await trx(this.tableName)
        .where("id", id)
        .update(updateData)
        .returning("*");
      // The row vanished between the controller's uuid→id resolution and this
      // UPDATE: write no history for an order that no longer exists (the FK
      // would raise 23503 anyway) and let the controller answer 404.
      if (!updated.length) return updated;
      await trx("sales_order_approval_events").insert({
        salesOrderId: id,
        stateMachine: machine,
        action,
        performedBy: username,
      });
      return updated;
    });

    return row ? await this.getByUuid(row.uuid) : null;
  }

  // ── List ─────────────────────────────────────────────────────────────────
  /**
   * The pedido grid (PedidosForm.ActualizarGrilla). Query params:
   * - `page`, `limit`, `sortBy`, `sortOrder`, `search` — reserved (query builder)
   * - `uuid`, `number`, `purchaseOrder` — column filters (`number` is a
   *   case-insensitive SUBSTRING, PedidoRepository.cs:69-72)
   * - `customerUuid`, `productUuid`, `partUuid`, `sheetSupplyUuid`,
   *   `salesUserUuid` — resolved to numeric ids here and applied as predicates;
   *   their numeric counterparts are NOT query params
   * - `deliveryDateFrom`, `deliveryDateTo` — inclusive bounds (a date-only
   *   `deliveryDateTo` covers the whole day)
   * - `fulfilled`, `voided`, `onlyApproved`, `withoutProductionOrders`,
   *   `allProductionOrdersFulfilled` — tri-state `true`/`false`/omitted
   * - `companyId` — the caller's company UUID (tenant scope)
   */
  async getAllWithFilters(
    req: Request,
    scopedCompanyUuid?: string,
  ): Promise<IDataPaginator<ISalesOrder>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // SECURITY (L-009): the caller's company scope arrives as an explicit
    // argument from the controller. Express 5 discards writes to req.query, so
    // the enforceCompanyFilter() query-mutation pattern cannot be relied on.
    const companyUuid =
      scopedCompanyUuid ??
      (parsedQuery.filters.companyId as string | undefined);
    delete parsedQuery.filters.companyId;

    // Derived (non column-operator) params: validated, then taken out of the
    // config's reach so `applyFilters` never sees them.
    const fulfilled = this.takeTriState(parsedQuery, "fulfilled");
    const voided = this.takeTriState(parsedQuery, "voided");
    const onlyApproved = this.takeTriState(parsedQuery, "onlyApproved");
    const withoutOrders = this.takeTriState(
      parsedQuery,
      "withoutProductionOrders",
    );
    const allOrdersFulfilled = this.takeTriState(
      parsedQuery,
      "allProductionOrdersFulfilled",
    );

    // Column filters whose VALUE needs validating; they stay in the config.
    parseDateParam("deliveryDateFrom", parsedQuery.filters.deliveryDateFrom);
    parseDateParam("deliveryDateTo", parsedQuery.filters.deliveryDateTo);

    // uuid filters resolve to numeric ids before the query is built; a
    // non-existent uuid pins the filter to the impossible id -1 (part.dao.ts
    // pattern). The resolved ids are applied inside `applyExtra` below, never
    // through the filter config — that is what keeps `?customerId=1` and its
    // four siblings unreachable on a uuid-only API.
    const resolvedIds: Array<[string, number]> = [];
    const resolveUuid = async (
      connection: any,
      filterKey: string,
      table: string,
      column: string,
    ): Promise<void> => {
      const id = await this.resolveUuidFilter(
        connection,
        parsedQuery,
        filterKey,
        table,
      );
      if (id !== undefined) resolvedIds.push([column, id]);
    };

    await resolveUuid(knex, "customerUuid", "customers", "customerId");
    await resolveUuid(knex, "productUuid", "products", "productId");
    await resolveUuid(knex, "partUuid", "parts", "partId");
    // Plancha pedidos point at the board catalogue (`paper_sheets`), the only
    // uuid-keyed sheet table in the schema; `sales_orders.sheetSupplyId` is
    // FK-less because the supplies module has not landed yet.
    await resolveUuid(knex, "sheetSupplyUuid", "paper_sheets", "sheetSupplyId");
    // `users` belongs to the CORE database, not erp: reading it on the erp
    // connection trips the registry's wrong-database guard (a throw outside
    // production, a warning in it). Cross-database reads name their own
    // connection, exactly as CountdownPeopleDAO does.
    await resolveUuid(db("core"), "salesUserUuid", "users", "salesUserId");

    /**
     * Everything that is not a column operator lives here, and this closure is
     * applied to the DATA query and to the COUNT query alike.
     *
     * INVARIANT (AC-18): a predicate that reaches only one of the two makes
     * `totalCount` lie under pagination. Nothing here may add a join — the
     * count query runs on the bare table, so derived predicates are column
     * predicates and correlated subqueries only.
     */
    const relatedOrders = () =>
      knex("production_orders")
        .select(knex.raw("1"))
        .whereRaw(
          `"production_orders"."orderDataId" = "${this.tableName}"."orderDataId"`,
        );
    const noOrders = (q: any) => q.whereNotExists(relatedOrders());
    const everyOrderFulfilled = (q: any) =>
      // Cumplida ⇔ Cumplimiento.HasValue (OrdenDeProduccion.cs:112): a voided
      // but uncompleted OP is NOT fulfilled, so `voidedAt` is never read here.
      q
        .whereExists(relatedOrders())
        .whereNotExists(
          relatedOrders().whereNull("production_orders.completedAt"),
        );

    const applyExtra = (q: any) => {
      applyCompanyUuidScope(q, this.tableName, companyUuid);
      for (const [column, id] of resolvedIds) {
        q.where(`${this.tableName}.${column}`, "=", id);
      }
      if (fulfilled === true) q.whereNotNull(`${this.tableName}.fulfilledAt`);
      else if (fulfilled === false)
        q.whereNull(`${this.tableName}.fulfilledAt`);
      if (voided === true) q.whereNotNull(`${this.tableName}.voidedAt`);
      else if (voided === false) q.whereNull(`${this.tableName}.voidedAt`);
      if (onlyApproved === true) {
        q.whereNotNull(`${this.tableName}.commercialApprovedAt`).whereNotNull(
          `${this.tableName}.financialApprovedAt`,
        );
      }
      // Listar.cs:168 — the two order filters are OR-ed with each other, and
      // the pair is AND-ed with everything else. One grouped `where(cb)` keeps
      // the OR from leaking into the surrounding AND chain.
      if (withoutOrders === true && allOrdersFulfilled === true) {
        q.where((builder: any) =>
          noOrders(builder).orWhere((inner: any) => everyOrderFulfilled(inner)),
        );
      } else if (withoutOrders === true) {
        noOrders(q);
      } else if (allOrdersFulfilled === true) {
        everyOrderFulfilled(q);
      }
      return q;
    };

    const dataQuery = applyExtra(this.selectWithJoins(knex));
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = applyExtra(knex(this.tableName));
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

  /** Validate a tri-state param and remove it from the config's filters. */
  private takeTriState(
    parsedQuery: ParsedQuery,
    name: string,
  ): boolean | undefined {
    const value = parseTriStateParam(name, parsedQuery.filters[name]);
    delete parsedQuery.filters[name];
    return value;
  }

  /**
   * Validate a `*Uuid` filter, take it out of the config's reach and answer the
   * numeric id it names — `-1` when the uuid matches nothing (a filter that
   * cannot match, never an unfiltered 200) and `undefined` when it was absent.
   */
  private async resolveUuidFilter(
    knex: any,
    parsedQuery: ParsedQuery,
    filterKey: string,
    table: string,
  ): Promise<number | undefined> {
    const uuid = assertUuidParam(filterKey, parsedQuery.filters[filterKey]);
    delete parsedQuery.filters[filterKey];
    if (!uuid) return undefined;
    const row = await knex(table).where("uuid", uuid).select("id").first();
    return row?.id ?? -1;
  }

  // ── Associated production orders (OrdenesAsociadasForm) ──────────────────
  /**
   * The OPs of the pedido's `order_data`, `number` ascending.
   *
   * L-009: the pedido is resolved through `applyCompanyUuidScope`, so another
   * tenant's uuid is indistinguishable from a missing one — `null` here, a 404
   * at the controller. `orderDataId IS NULL` is an EMPTY list, never an error
   * (spec §API surface).
   */
  async getAssociatedProductionOrders(
    salesOrderUuid: string,
    companyUuid: string | undefined,
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IAssociatedProductionOrder> | null> {
    const knex = db("erp");
    const orderQuery = knex(this.tableName).where(
      `${this.tableName}.uuid`,
      salesOrderUuid,
    );
    applyCompanyUuidScope(orderQuery, this.tableName, companyUuid);
    const order = await orderQuery
      .select(
        `${this.tableName}.orderDataId`,
        `${this.tableName}.number as salesOrderNumber`,
      )
      .first();
    if (!order) return null;

    const empty = (totalCount: number, rows: IAssociatedProductionOrder[]) => ({
      success: true as const,
      data: rows,
      page,
      limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    });
    if (order.orderDataId == null) return empty(0, []);

    const scoped = () =>
      knex("production_orders").where(
        "production_orders.orderDataId",
        order.orderDataId,
      );

    const [rows, totalResult] = await Promise.all([
      scoped()
        .leftJoin("parts as part", "production_orders.partId", "part.id")
        .leftJoin("products as prod", "part.productId", "prod.id")
        .leftJoin("customers as cust", "prod.customerId", "cust.id")
        .select(
          "production_orders.uuid",
          "production_orders.number",
          "production_orders.orderDate",
          "production_orders.deliveryDate",
          "production_orders.quantity",
          "production_orders.schedulingApprovedAt",
          "production_orders.completedAt",
          "production_orders.voidedAt",
          // Aliased, never selected as numeric ids (uuid-only surface).
          "part.uuid as partUuid",
          "part.code as partCode",
          "part.description as partDescription",
          "cust.uuid as customerUuid",
          "cust.name as customerName",
        )
        .orderBy("production_orders.number", "asc")
        .limit(limit)
        .offset((page - 1) * limit),
      scoped().count("* as count").first(),
    ]);

    return empty(
      parseInt(totalResult?.count as string) || 0,
      rows.map((row: any) => ({
        uuid: row.uuid,
        number: row.number,
        orderDate: row.orderDate ?? null,
        deliveryDate: row.deliveryDate ?? null,
        quantity: toNumberOut(row.quantity) ?? 0,
        part: row.partUuid
          ? {
              uuid: row.partUuid,
              code: row.partCode ?? null,
              description: row.partDescription ?? null,
            }
          : null,
        customer: row.customerUuid
          ? { uuid: row.customerUuid, name: row.customerName ?? null }
          : null,
        schedulingApprovedAt: row.schedulingApprovedAt ?? null,
        completedAt: row.completedAt ?? null,
        voidedAt: row.voidedAt ?? null,
      })),
    );
  }

  // ── Mapping ──────────────────────────────────────────────────────────────
  // SECURITY: uuid-only surface; numeric ids stripped from nested objects.
  private mapToInterface(record: any): ISalesOrder {
    const flags = {
      commerciallyApproved: record.commercialApprovedAt != null,
      financiallyApproved: record.financialApprovedAt != null,
      fulfilled: record.fulfilledAt != null,
      voided: record.voidedAt != null,
      creditLimitOverridden: record.creditLimitOverrideAt != null,
    };

    const order: ISalesOrder = {
      uuid: record.uuid,
      // Internal: the response middleware strips numeric *Id keys globally;
      // controllers need it to scope follow-up lookups (L-009).
      companyId: record.companyId,
      number: record.number,
      quantity: toNumberOut(record.quantity) ?? 0,
      price: toNumberOut(record.price),
      paid: toNumberOut(record.paid),
      deliveryDate: record.deliveryDate ?? null,
      purchaseOrder: record.purchaseOrder ?? null,
      stockOrder: record.stockOrder ?? false,
      specialOrder: record.specialOrder ?? false,
      needsAdvanceInvoice: record.needsAdvanceInvoice ?? null,
      invoiceSent: record.invoiceSent ?? null,
      salesSector: record.salesSector ?? null,
      balancePercentage: toNumberOut(record.balancePercentage),
      supplierCode: record.supplierCode ?? null,
      createdBy: record.createdBy ?? null,
      purchaseOrderImageFileUuid: record.purchaseOrderImageFileUuid ?? null,
      quotationFileUuid: record.quotationFileUuid ?? null,
      legacyId: record.legacyId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,

      itemDescription: itemDescriptionOf(record),

      customer: pickRef(record.customer, ["name", "code"]),
      product: pickRef(record.product, ["code", "description"]),
      salesUser: pickRef(record.salesUser, ["name", "email"]),
      orderData: this.orderDataDAO.mapToInterface(
        record.orderData,
        record.deliveryLocation,
      ) as IOrderData | null,

      // Derived, never stored (Pedido.cs:120-135).
      priceTotal: toNumberOut(record.priceTotal),
      ...flags,
      status: deriveSalesOrderStatus(flags),
    };

    for (const key of LIFECYCLE_COLUMNS) {
      (order as Record<string, unknown>)[key] = record[key] ?? null;
    }
    return order;
  }
}

/**
 * Grid column 6, verbatim from the three TPH subtype overrides:
 * `PedidoDeProducto.cs:19`, `PedidoDeParte.cs:18`, `PedidoDePlancha.cs:20`.
 * A pedido always has exactly one of the three (the table's CHECK constraint),
 * but a row with none of them prints the empty string rather than throwing.
 */
function itemDescriptionOf(record: any): string {
  if (record.product) {
    return `Producto: ${record.product.code} - ${record.product.description} - Revisión: ${record.product.revision}`;
  }
  if (record.part) {
    return `Parte: ${record.part.code} - ${record.part.description} - Revisión: ${record.part.revision}`;
  }
  if (record.sheetSupply) {
    return `Plancha: ${record.sheetSupply.code} - ${record.sheetSupply.description}`;
  }
  return "";
}

/** Nested reference: uuid plus the requested label fields, never numeric ids. */
function pickRef(obj: any, fields: string[]): ISalesOrderRef | null {
  if (!obj) return null;
  const ref: Record<string, unknown> = { uuid: obj.uuid };
  for (const field of fields) {
    if (obj[field] !== undefined) ref[field] = obj[field];
  }
  return ref as unknown as ISalesOrderRef;
}
