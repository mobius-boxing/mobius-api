import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  IProductionOrder,
  IProductionOrderRef,
  LifecycleAction,
  LifecycleMachine,
} from "../../interfaces/production-order/production-order.interfaces";
import { toCountOut, toNumberOut } from "../../utils/numbers";
import { applyCompanyUuidScope } from "../../utils/daoScope";
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
  assertUuidParam,
  parseDateParam,
  parseEnumParam,
} from "../../utils/query-params";

/**
 * companyId arrives as a UUID and is applied as a join in `applyExtra`;
 * partUuid / orderDataUuid / salesOrderUuid are pre-resolved into the numeric
 * filters below, and customerUuid plus the three lifecycle-state and four
 * date-range params are `applyExtra` predicates (part.dao.ts:653-728 pattern).
 * The derived reads (`habilitada`, `cumplida`, `anulada`) are NOT filters —
 * they are computed, and `schedulingState`/`completionState`/`voidState` are
 * the queryable form.
 */
const PRODUCTION_ORDER_FILTERS: FilterConfigs = {
  uuid: { column: "uuid", operator: "=" },
  number: { column: "number", operator: "ILIKE" },
};

/**
 * Resolved internal ids. Deliberately NOT in PRODUCTION_ORDER_FILTERS: this is
 * a uuid-only surface, and a client-supplied `?partId=5` would be sequential-id
 * enumeration. `resolveUuidFilter` puts values here and `applyResolvedIds`
 * applies them to BOTH the data and the count builder — a resolved id that
 * reaches only one of them makes `totalCount` disagree with `data`.
 */
const RESOLVED_ID_KEYS = ["partId", "orderDataId"] as const;

/**
 * The value sets of the three lifecycle-state params. They are the queryable
 * form of the derived reads above, and a value outside these sets is rejected —
 * never silently dropped (L-007).
 */
const SCHEDULING_STATES = ["enabled", "disabled"] as const;
const COMPLETION_STATES = ["open", "completed"] as const;
const VOID_STATES = ["active", "voided"] as const;

const PRODUCTION_ORDER_SORTING: SortConfigs = {
  number: { column: "number" },
  orderDate: { column: "orderDate" },
  deliveryDate: { column: "deliveryDate" },
  quantity: { column: "quantity" },
  createdAt: { column: "createdAt" },
};

const PRODUCTION_ORDER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "production_orders",
  {
    filters: PRODUCTION_ORDER_FILTERS,
    sorting: PRODUCTION_ORDER_SORTING,
    search: { columns: ["number"], operator: "ILIKE" },
    defaultSort: { column: "createdAt", order: "desc" },
  },
);

/**
 * Machine → its timestamp+user column pairs
 * (OrdenDeProduccion.cs:209-231, 238-260, 267-325). The three machines are
 * ORTHOGONAL: a transition writes these four columns and nothing else, so no
 * machine can observe or disturb another.
 */
const LIFECYCLE_COLUMNS: Record<
  LifecycleMachine,
  { setAt: string; setBy: string; cancelledAt: string; cancelledBy: string }
> = {
  scheduling: {
    setAt: "schedulingApprovedAt",
    setBy: "schedulingApprovedByUser",
    cancelledAt: "schedulingCancelledAt",
    cancelledBy: "schedulingCancelledByUser",
  },
  completion: {
    setAt: "completedAt",
    setBy: "completedByUser",
    cancelledAt: "completionCancelledAt",
    cancelledBy: "completionCancelledByUser",
  },
  void: {
    setAt: "voidedAt",
    setBy: "voidedByUser",
    cancelledAt: "voidCancelledAt",
    cancelledBy: "voidCancelledByUser",
  },
};

/** Columns a create/update payload may write. `number` is handled separately. */
const SCALAR_COLUMNS = [
  "orderDate",
  "quantity",
  "deliveryDate",
  "notes",
  "newPlate",
  "newPlateReady",
  "newDie",
  "newDieReady",
  "isSample",
  "dispatchable",
  "lastLabelNumber",
  "compression",
  "burst",
  "cobb",
  "testedInternalLength",
  "testedInternalWidth",
  "testedInternalHeight",
  "testedExternalLength",
  "testedExternalWidth",
  "testedExternalHeight",
  "avgGrammage",
  "avgWeight",
  "compressionMax",
  "compressionMin",
  "compressionAvg",
  "cobbMax",
  "cobbMin",
  "cobbAvg",
  "avgBurst",
  "partId",
  "orderDataId",
  "routeId",
  "palletizationId",
  "legacyId",
] as const;

/** Every float column, so mapToInterface never leaks a pg string. */
const FLOAT_COLUMNS = [
  "quantity",
  "compression",
  "burst",
  "cobb",
  "testedInternalLength",
  "testedInternalWidth",
  "testedInternalHeight",
  "testedExternalLength",
  "testedExternalWidth",
  "testedExternalHeight",
  "avgGrammage",
  "avgWeight",
  "compressionMax",
  "compressionMin",
  "compressionAvg",
  "cobbMax",
  "cobbMin",
  "cobbAvg",
  "avgBurst",
] as const;

/** What the row-level validator needs, resolved in one round trip. */
export interface IOrderValidationContextRow {
  routeStageCount: number;
  partApproved: boolean;
  customerActive: boolean;
  productId: number | null;
  productCode: string | null;
}

/** The pedido row generation works from, plus its `order_data` header. */
export interface ILockedSalesOrder {
  id: number;
  uuid: string;
  companyId: number;
  partId: number | null;
  orderDataId: number | null;
  quantity: number;
  deliveryDate: Date | null;
  commercialApprovedAt: Date | null;
  financialApprovedAt: Date | null;
  voidedAt: Date | null;
  fulfilledAt: Date | null;
  fulfilledBy: string | null;
  purchaseOrderImageFileUuid: string | null;
  productId: number | null;
  productCode: string | null;
  orderDataNumber: string | null;
}

export class ProductionOrderDAO {
  private tableName = "production_orders";
  private queryConfig = PRODUCTION_ORDER_QUERY_CONFIG;

  // ── Reads ────────────────────────────────────────────────────────────────
  private selectWithJoins(knex: any) {
    return knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        knex.raw(
          `CASE WHEN part.id IS NOT NULL THEN to_jsonb(part) END as "part"`,
        ),
        knex.raw(
          `CASE WHEN prod.id IS NOT NULL THEN to_jsonb(prod) END as "product"`,
        ),
        knex.raw(
          `CASE WHEN cust.id IS NOT NULL THEN to_jsonb(cust) END as "customer"`,
        ),
        knex.raw(
          `CASE WHEN od.id IS NOT NULL THEN to_jsonb(od) END as "orderData"`,
        ),
        knex.raw(
          `CASE WHEN so.id IS NOT NULL THEN to_jsonb(so) END as "salesOrder"`,
        ),
        knex.raw(
          `CASE WHEN route.id IS NOT NULL THEN to_jsonb(route) END as "route"`,
        ),
        knex.raw(
          `CASE WHEN pall.id IS NOT NULL THEN to_jsonb(pall) END as "palletization"`,
        ),
      )
      .leftJoin("parts as part", `${this.tableName}.partId`, "part.id")
      .leftJoin("products as prod", "part.productId", "prod.id")
      .leftJoin("customers as cust", "prod.customerId", "cust.id")
      .leftJoin("order_data as od", `${this.tableName}.orderDataId`, "od.id")
      .leftJoin("sales_orders as so", "so.orderDataId", "od.id")
      .leftJoin(
        "production_routes as route",
        `${this.tableName}.routeId`,
        "route.id",
      )
      .leftJoin(
        "palletizations as pall",
        `${this.tableName}.palletizationId`,
        "pall.id",
      );
  }

  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IProductionOrder | null> {
    const knex = db("erp");
    const query = this.selectWithJoins(knex).where(
      `${this.tableName}.uuid`,
      uuid,
    );
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const row = await query.first();
    if (!row) return null;
    // L-005: re-attach the numeric ids explicitly — mapToInterface strips them,
    // and callers that guard on `existing.id` would 404 forever otherwise. The
    // FK ids come back too because `beforeUpdate` re-runs the validator over
    // the MERGED row: a PUT that does not resend `partUuid` must still know
    // which part the order has, or every partial update fails V1. All five keys
    // are removed again by the global uuid-only response sanitizer.
    //
    // A NULL fk is left OFF the object rather than set to null: the sanitizer
    // only drops `*Id` keys whose value is a NUMBER, so `orderDataId: null`
    // would survive it and reappear on the public surface.
    const internal: Record<string, number> = { id: row.id, partId: row.partId };
    for (const key of ["orderDataId", "routeId", "palletizationId"] as const) {
      if (row[key] != null) internal[key] = row[key];
    }
    return { ...this.mapToInterface(row), ...internal };
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

  // ── Writes ───────────────────────────────────────────────────────────────
  async create(item: IProductionOrder): Promise<IProductionOrder> {
    const knex = db("erp");
    const insertData = this.toInsertData(item);
    const [row] = await knex(this.tableName).insert(insertData).returning("*");
    return (await this.getByUuid(row.uuid)) ?? this.mapToInterface(row);
  }

  /** Insert inside the CALLER's transaction (generation's all-or-nothing loop). */
  async insertTrx(trx: any, item: IProductionOrder): Promise<any> {
    const [row] = await trx(this.tableName)
      .insert(this.toInsertData(item))
      .returning("*");
    return row;
  }

  private toInsertData(item: IProductionOrder): Record<string, unknown> {
    const insertData: Record<string, unknown> = {
      uuid: item.uuid ?? uuidv4(),
      companyId: item.companyId,
      number: item.number,
      createdByUser: item.createdByUser ?? null,
    };
    const source = item as Record<string, unknown>;
    for (const key of SCALAR_COLUMNS) {
      if (source[key] !== undefined) insertData[key] = source[key];
    }
    // A generated order may be born habilitada and/or already cumplida
    // (OrdenesHabilitadasPorDefecto; the pedido's fulfillment copy).
    for (const machine of Object.keys(
      LIFECYCLE_COLUMNS,
    ) as LifecycleMachine[]) {
      const cols = LIFECYCLE_COLUMNS[machine];
      for (const column of [
        cols.setAt,
        cols.setBy,
        cols.cancelledAt,
        cols.cancelledBy,
      ]) {
        if (source[column] !== undefined) insertData[column] = source[column];
      }
    }
    return insertData;
  }

  async update(
    id: number,
    item: Partial<IProductionOrder>,
  ): Promise<IProductionOrder | null> {
    const knex = db("erp");
    const updateData: Record<string, unknown> = {};
    const source = item as Record<string, unknown>;
    for (const key of SCALAR_COLUMNS) {
      if (source[key] !== undefined) updateData[key] = source[key];
    }
    if (source.number !== undefined) updateData.number = source.number;
    updateData.updatedAt = knex.fn.now();

    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? await this.getByUuid(row.uuid) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("erp");
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  /**
   * Stamp ONE machine's pair inside the caller's transaction. The update object
   * carries exactly FIVE keys — the machine's four columns plus `updatedAt` —
   * which is what makes "the other two machines are untouched" provable.
   *
   * There is no state guard and no company predicate: the transition is
   * unconditional (the machines are orthogonal) and the company check already
   * happened in the controller (L-009).
   *
   * `afterComplete` is the pedido roll-up seam, awaited INSIDE this
   * transaction with the completed row in hand. It fires for
   * `completion`/`set` ONLY: Procusto reacts to `OrdenCumplida` and has no
   * reverse event, so un-completing an order must not un-fulfill its pedido
   * (HandlerEventosPC.cs:20-52). Optional and trailing, so every existing
   * caller and test is unaffected.
   */
  async setLifecycleTrx(
    trx: any,
    id: number,
    machine: LifecycleMachine,
    action: LifecycleAction,
    username: string,
    afterComplete?: (trx: any, row: any) => Promise<void>,
  ): Promise<any | null> {
    const cols = LIFECYCLE_COLUMNS[machine];
    const updateData: Record<string, unknown> = { updatedAt: trx.fn.now() };
    if (action === "set") {
      updateData[cols.setAt] = trx.fn.now();
      updateData[cols.setBy] = username;
      updateData[cols.cancelledAt] = null;
      updateData[cols.cancelledBy] = null;
    } else {
      updateData[cols.cancelledAt] = trx.fn.now();
      updateData[cols.cancelledBy] = username;
      updateData[cols.setAt] = null;
      updateData[cols.setBy] = null;
    }
    const [row] = await trx(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    if (row && afterComplete && machine === "completion" && action === "set") {
      await afterComplete(trx, row);
    }
    return row ?? null;
  }

  // ── Generation support ───────────────────────────────────────────────────
  /**
   * Lock the pedido row so two concurrent generations serialise: the loser
   * reaches the "already has orders" guard only after the winner has
   * committed. `FOR UPDATE OF sales_orders` is deliberate BECAUSE the company
   * scope is a JOIN (`utils/daoScope.ts:26-30`): a bare `FOR UPDATE` would lock
   * the joined `companies` row too and serialise unrelated tenant writes, so
   * the lock has to name the table it means.
   */
  async lockSalesOrderTrx(
    trx: any,
    uuid: string,
    companyUuid?: string,
  ): Promise<ILockedSalesOrder | null> {
    return this.readSalesOrder(
      trx,
      (q: any) => q.where("sales_orders.uuid", uuid),
      companyUuid,
      true,
    );
  }

  /**
   * The same read WITHOUT the lock, for the read-only eligibility endpoint.
   * Taking `FOR UPDATE` there would let a dialog opening block a concurrent
   * generation for no reason.
   */
  async readSalesOrderForGeneration(
    uuid: string,
    companyUuid?: string,
  ): Promise<ILockedSalesOrder | null> {
    return this.readSalesOrder(
      db("erp"),
      (q: any) => q.where("sales_orders.uuid", uuid),
      companyUuid,
      false,
    );
  }

  /**
   * The pedido behind an `order_data` row — the manual-create path knows the
   * order_data reference, not the pedido uuid, and needs the pedido's quantity
   * and product to compute its warnings. `sales_orders.orderDataId` is UNIQUE,
   * so this is 1:1.
   */
  async readSalesOrderByOrderDataId(
    orderDataId: number,
  ): Promise<ILockedSalesOrder | null> {
    return this.readSalesOrder(
      db("erp"),
      (q: any) => q.where("sales_orders.orderDataId", orderDataId),
      undefined,
      false,
    );
  }

  private async readSalesOrder(
    knex: any,
    applyWhere: (q: any) => any,
    companyUuid: string | undefined,
    lock: boolean,
  ): Promise<ILockedSalesOrder | null> {
    const query = applyWhere(knex("sales_orders").select("sales_orders.*"));
    applyCompanyUuidScope(query, "sales_orders", companyUuid);
    // `FOR UPDATE OF sales_orders`, never a bare FOR UPDATE: the company scope
    // above joins `companies`, and locking a company row on every generation
    // would serialise unrelated tenant writes.
    if (lock) query.forUpdate("sales_orders");
    const row = await query.first();
    if (!row) return null;

    // Second round trips rather than joins: `FOR UPDATE` over a join would
    // drag order_data and products into the lock for no reason.
    const orderData = row.orderDataId
      ? await knex("order_data")
          .where("id", row.orderDataId)
          .select("number")
          .first()
      : null;
    const product = row.productId
      ? await knex("products").where("id", row.productId).select("code").first()
      : null;

    return {
      productCode: product?.code ?? null,
      id: row.id,
      uuid: row.uuid,
      companyId: row.companyId,
      partId: row.partId ?? null,
      orderDataId: row.orderDataId ?? null,
      quantity: toNumberOut(row.quantity) ?? 0,
      deliveryDate: row.deliveryDate ?? null,
      commercialApprovedAt: row.commercialApprovedAt ?? null,
      financialApprovedAt: row.financialApprovedAt ?? null,
      voidedAt: row.voidedAt ?? null,
      fulfilledAt: row.fulfilledAt ?? null,
      fulfilledBy: row.fulfilledBy ?? null,
      purchaseOrderImageFileUuid: row.purchaseOrderImageFileUuid ?? null,
      productId: row.productId ?? null,
      orderDataNumber: orderData?.number ?? null,
    };
  }

  /**
   * The ERP connection is owned HERE, not by the callers: the architecture
   * check keeps `database/registry` out of services and controllers, so the
   * generation transaction is opened through the DAO that lives inside it.
   */
  async transaction<T>(body: (trx: any) => Promise<T>): Promise<T> {
    return db("erp").transaction(body);
  }

  /**
   * G3's read: does this pedido already own production orders? `trx` is the
   * generation transaction on the write path and omitted on the read-only
   * eligibility path.
   */
  async countByOrderDataId(orderDataId: number, trx?: any): Promise<number> {
    const knex = trx ?? db("erp");
    const row = await knex(this.tableName)
      .where("orderDataId", orderDataId)
      .count("* as count")
      .first();
    return toCountOut(row?.count);
  }

  /**
   * SECURITY (L-009): uuid → numeric id for ONE of the four reference tables
   * this entity points at, scoped to the caller's company. The shared
   * `foreignKeyResolver.getIdByUuid` has no company argument, so using it here
   * would let a caller attach another tenant's parte, ruta or palletizado to
   * their own order — and then read that row back through the list joins.
   *
   * `table` never comes from the request: the controller passes one of the four
   * literals in its REFERENCES map.
   */
  async resolveReferenceId(
    table: string,
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    const query = db("erp")(table)
      .where(`${table}.uuid`, uuid)
      .select(`${table}.id`);
    applyCompanyUuidScope(query, table, companyUuid);
    const row = await query.first();
    return row?.id ?? null;
  }

  /** `order_data.number`, the parent key of the pedido-dependent OP number. */
  async getOrderDataNumber(orderDataId: number): Promise<string | null> {
    const row = await db("erp")("order_data")
      .where("id", orderDataId)
      .select("number")
      .first();
    return row?.number ?? null;
  }

  /**
   * Everything `validateProductionOrder` needs about the part and its effective
   * route, in one round trip. Returns null when the part does not exist — the
   * caller turns that into V1's "no part" problem rather than a 500.
   */
  async loadOrderValidationContext(
    args: { partId: number | null; routeId?: number | null },
    trx?: any,
  ): Promise<IOrderValidationContextRow | null> {
    if (!args.partId) return null;
    const knex = trx ?? db("erp");
    const part = await knex("parts")
      .where("parts.id", args.partId)
      .leftJoin("products as prod", "parts.productId", "prod.id")
      .leftJoin("customers as cust", "prod.customerId", "cust.id")
      .select(
        "parts.partApprovalAt as partApprovalAt",
        "parts.productionRouteId as productionRouteId",
        "prod.id as productId",
        "prod.code as productCode",
        "cust.active as customerActive",
      )
      .first();
    if (!part) return null;

    const effectiveRouteId = args.routeId ?? part.productionRouteId ?? null;
    const stages = effectiveRouteId
      ? await knex("production_route_stages")
          .where("routeId", effectiveRouteId)
          .count("* as count")
          .first()
      : null;

    return {
      routeStageCount: toCountOut(stages?.count),
      partApproved: part.partApprovalAt != null,
      // A part with no product/customer has nothing to be inactive.
      customerActive: part.customerActive !== false,
      productId: part.productId ?? null,
      productCode: part.productCode ?? null,
    };
  }

  // ── List ─────────────────────────────────────────────────────────────────
  async getAllWithFilters(
    req: Request,
    scopedCompanyUuid?: string,
  ): Promise<IDataPaginator<IProductionOrder>> {
    const knex = db("erp");
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    // SECURITY (L-009): the caller's company scope arrives as an explicit
    // argument. Express 5 discards writes to req.query, so the
    // enforceCompanyFilter() mutation pattern cannot be relied on.
    const companyUuid =
      scopedCompanyUuid ??
      (parsedQuery.filters.companyId as string | undefined);
    delete parsedQuery.filters.companyId;

    await this.resolveUuidFilter(
      knex,
      parsedQuery,
      "partUuid",
      "parts",
      "partId",
    );
    await this.resolveUuidFilter(
      knex,
      parsedQuery,
      "orderDataUuid",
      "order_data",
      "orderDataId",
    );
    // A pedido reaches its OPs through order_data, never directly (the FK
    // points at order_data — see the migration header).
    const salesOrderUuid = assertUuidParam(
      "salesOrderUuid",
      this.takeFilter(parsedQuery, "salesOrderUuid"),
    );
    if (salesOrderUuid) {
      const salesOrder = await knex("sales_orders")
        .where("uuid", salesOrderUuid)
        .select("orderDataId")
        .first();
      parsedQuery.filters.orderDataId = String(salesOrder?.orderDataId ?? -1);
    }

    const customerUuid = assertUuidParam(
      "customerUuid",
      this.takeFilter(parsedQuery, "customerUuid"),
    );
    // L-007: a value outside the documented set is a 400 naming the param, not
    // a 200 with the predicate quietly dropped — `?schedulingState=bogus` used
    // to answer with the UNFILTERED list.
    const schedulingState = this.takeEnumFilter(
      parsedQuery,
      "schedulingState",
      SCHEDULING_STATES,
    );
    const completionState = this.takeEnumFilter(
      parsedQuery,
      "completionState",
      COMPLETION_STATES,
    );
    const voidState = this.takeEnumFilter(
      parsedQuery,
      "voidState",
      VOID_STATES,
    );
    // Every date goes through `parseDateParam`: handing Postgres an
    // `Invalid Date` raises 22007 inside the driver, and the generic error
    // handler echoes the generated SQL back to the caller.
    const deliveryDateFrom = this.takeDateFilter(
      parsedQuery,
      "deliveryDateFrom",
    );
    const deliveryDateTo = this.takeDateFilter(parsedQuery, "deliveryDateTo");
    const orderDateFrom = this.takeDateFilter(parsedQuery, "orderDateFrom");
    const orderDateTo = this.takeDateFilter(parsedQuery, "orderDateTo");

    const table = this.tableName;
    // The ids `resolveUuidFilter` produced. They are applied INSIDE applyExtra
    // (never via FilterConfigs) so they reach the count builder too, and so a
    // client cannot supply them directly on this uuid-only surface.
    const resolvedIds: Array<[string, number]> = [];
    for (const key of RESOLVED_ID_KEYS) {
      const raw = parsedQuery.filters[key];
      if (raw === undefined) continue;
      delete parsedQuery.filters[key];
      resolvedIds.push([key, parseInt(String(raw), 10)]);
    }

    const applyExtra = (q: any) => {
      for (const [key, value] of resolvedIds) q.where(`${table}.${key}`, value);

      if (schedulingState === "enabled")
        q.whereNotNull(`${table}.schedulingApprovedAt`);
      else if (schedulingState === "disabled")
        q.whereNull(`${table}.schedulingApprovedAt`);

      if (completionState === "completed")
        q.whereNotNull(`${table}.completedAt`);
      else if (completionState === "open") q.whereNull(`${table}.completedAt`);

      if (voidState === "voided") q.whereNotNull(`${table}.voidedAt`);
      else if (voidState === "active") q.whereNull(`${table}.voidedAt`);

      if (deliveryDateFrom)
        q.where(`${table}.deliveryDate`, ">=", deliveryDateFrom);
      if (deliveryDateTo)
        q.where(`${table}.deliveryDate`, "<=", deliveryDateTo);
      if (orderDateFrom) q.where(`${table}.orderDate`, ">=", orderDateFrom);
      if (orderDateTo) q.where(`${table}.orderDate`, "<=", orderDateTo);

      if (customerUuid) {
        q.whereIn(
          `${table}.partId`,
          knex("parts")
            .join("products", "parts.productId", "products.id")
            .join("customers", "products.customerId", "customers.id")
            .where("customers.uuid", customerUuid)
            .select("parts.id"),
        );
      }
      if (companyUuid) {
        q.join("companies", `${table}.companyId`, "companies.id").where(
          "companies.uuid",
          companyUuid,
        );
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
    const totalCount = toCountOut(totalResult?.count);

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

  /** Pull a filter out of the parsed query so buildQuery never sees it. */
  private takeFilter(
    parsedQuery: ParsedQuery,
    key: string,
  ): string | undefined {
    const value = parsedQuery.filters[key] as string | undefined;
    delete parsedQuery.filters[key];
    return value || undefined;
  }

  /** The same, validated against the param's documented value set. */
  private takeEnumFilter<T extends string>(
    parsedQuery: ParsedQuery,
    key: string,
    allowed: readonly T[],
  ): T | undefined {
    return parseEnumParam(key, this.takeFilter(parsedQuery, key), allowed);
  }

  /** The same, parsed into a Date — an unparseable value never reaches PG. */
  private takeDateFilter(
    parsedQuery: ParsedQuery,
    key: string,
  ): Date | undefined {
    return parseDateParam(key, this.takeFilter(parsedQuery, key));
  }

  /** uuid → numeric id; a non-existent uuid pins the filter to the impossible -1. */
  private async resolveUuidFilter(
    knex: any,
    parsedQuery: ParsedQuery,
    filterKey: string,
    table: string,
    numericKey: string,
  ): Promise<void> {
    // L-007: a malformed uuid is a 400 naming the param, never a DB round trip
    // that comes back as a generic 22P02 "Invalid data type provided."
    const uuid = assertUuidParam(
      filterKey,
      this.takeFilter(parsedQuery, filterKey),
    );
    if (!uuid) return;
    const row = await knex(table).where("uuid", uuid).select("id").first();
    parsedQuery.filters[numericKey] = String(row?.id ?? -1);
  }

  // ── Mapping ──────────────────────────────────────────────────────────────
  // SECURITY: uuid-only surface; numeric ids stripped from nested objects.
  mapToInterface(record: any): IProductionOrder {
    const order: IProductionOrder = {
      uuid: record.uuid,
      // Internal: the response middleware strips numeric *Id keys globally;
      // controllers need it to scope follow-up lookups and config reads (L-009).
      companyId: record.companyId,
      number: record.number,
      orderDate: record.orderDate ?? null,
      deliveryDate: record.deliveryDate ?? null,
      notes: record.notes ?? null,
      newPlate: record.newPlate ?? false,
      newPlateReady: record.newPlateReady ?? false,
      newDie: record.newDie ?? false,
      newDieReady: record.newDieReady ?? false,
      isSample: record.isSample ?? false,
      dispatchable: record.dispatchable ?? null,
      lastLabelNumber: record.lastLabelNumber ?? null,
      createdAt: record.createdAt,
      createdByUser: record.createdByUser ?? null,
      updatedAt: record.updatedAt ?? null,
      legacyId: record.legacyId ?? null,

      part: pickRef(record.part, ["code", "description"]),
      product: pickRef(record.product, ["code", "description"]),
      customer: pickRef(record.customer, ["name", "code"]),
      orderData: pickRef(record.orderData, ["number"]),
      salesOrder: pickRef(record.salesOrder, ["number"]),
      route: pickRef(record.route, ["name"]),
      palletization: pickRef(record.palletization, ["code", "name"]),

      // Derived, never stored (OrdenDeProduccion.cs:109-127).
      habilitada: record.schedulingApprovedAt != null,
      cumplida: record.completedAt != null,
      anulada: record.voidedAt != null,
      clisePendiente: !!record.newPlate && !record.newPlateReady,
      troquelPendiente: !!record.newDie && !record.newDieReady,
    };

    const target = order as Record<string, unknown>;
    for (const key of FLOAT_COLUMNS) {
      target[key] = toNumberOut(record[key]);
    }
    // quantity is NOT NULL in the schema; keep it a number on the surface.
    order.quantity = toNumberOut(record.quantity) ?? 0;

    for (const machine of Object.keys(
      LIFECYCLE_COLUMNS,
    ) as LifecycleMachine[]) {
      const cols = LIFECYCLE_COLUMNS[machine];
      for (const column of [
        cols.setAt,
        cols.setBy,
        cols.cancelledAt,
        cols.cancelledBy,
      ]) {
        target[column] = record[column] ?? null;
      }
    }
    return order;
  }
}

/** Nested reference: uuid plus the requested label fields, never numeric ids. */
function pickRef(obj: any, fields: string[]): IProductionOrderRef | null {
  if (!obj) return null;
  const ref: Record<string, unknown> = { uuid: obj.uuid };
  for (const field of fields) {
    if (obj[field] !== undefined) ref[field] = obj[field];
  }
  return ref as unknown as IProductionOrderRef;
}

export {
  LIFECYCLE_COLUMNS,
  PRODUCTION_ORDER_FILTERS,
  PRODUCTION_ORDER_SORTING,
};
