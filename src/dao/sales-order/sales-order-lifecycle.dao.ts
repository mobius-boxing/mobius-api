import { db } from "../../database/registry";
import { ISalesOrder } from "../../interfaces/sales-order/sales-order.interfaces";
import { toNumberOut } from "../../utils/numbers";
import { LIFECYCLE_COLUMNS } from "../production-order/production-order.dao";
import { SalesOrderDAO } from "./sales-order.dao";

/** `PATCH /sales-orders/:uuid/fulfillment` actions (Pedido.cs:184-206). */
export type FulfillmentAction = "fulfill" | "cancel";

/** `PATCH /sales-orders/:uuid/void` actions (Pedido.cs:155-177). */
export type VoidAction = "void" | "cancel";

/** The only rejection this DAO reports; the controller turns it into a 409. */
export type LifecycleRejection = "ORDER_ALREADY_FULFILLED";

export interface ILifecycleOutcome {
  /** False for a no-op AND for a rejection: nothing was written either way. */
  changed: boolean;
  /**
   * The row was gone by the time the transaction locked it — it was deleted
   * between the controller's uuid→id resolution and this UPDATE. The controller
   * answers 404, never a 200 `{data: null}` (the twin of the `setApproval`
   * TOCTOU window).
   */
  missing?: boolean;
  rejected?: LifecycleRejection;
  productionOrdersAffected: number;
  /** The DTO, read after the commit; null only when the row vanished. */
  order: ISalesOrder | null;
}

/** What `HandlerEventosPC.cs:35-46` needs to decide, in one round trip. */
export interface IAutoFulfillCandidate {
  id: number;
  uuid: string;
  /** The pedido's tenant, carried so the stamp can predicate on it (L-009). */
  companyId: number | null;
  quantity: number;
  fulfilledAt: Date | null;
  opCount: number;
  incompleteCount: number;
  opQuantitySum: number;
}

/** The pedido's fulfillment pair + its reversal pair (D-2 of the create spec). */
const FULFILLMENT_COLUMNS = {
  setAt: "fulfilledAt",
  setBy: "fulfilledBy",
  cancelledAt: "fulfillmentCancelledAt",
  cancelledBy: "fulfillmentCancelledBy",
} as const;

/** The pedido's anulación pair + its reversal pair. */
const VOID_COLUMNS = {
  setAt: "voidedAt",
  setBy: "voidedBy",
  cancelledAt: "voidCancelledAt",
  cancelledBy: "voidCancelledBy",
} as const;

/**
 * The production order's completion and anulación pairs, IMPORTED from module
 * 13's own `LIFECYCLE_COLUMNS` rather than re-declared. This file is a second
 * writer of `production_orders`; a private copy of the column names would
 * silently unpin that feature's "exactly four columns per machine" AC the first
 * time it renames one.
 */
const OP_COMPLETION_COLUMNS = LIFECYCLE_COLUMNS.completion;
const OP_VOID_COLUMNS = LIFECYCLE_COLUMNS.void;

type PairColumns = {
  setAt: string;
  setBy: string;
  cancelledAt: string;
  cancelledBy: string;
};

/**
 * One transition = the pair stamped and its opposite pair nulled, never a
 * partial write (Pedido.cs:155-206). `now` is the transaction's single
 * timestamp, shared by the order row and every cascaded row.
 */
const pairUpdate = (
  cols: PairColumns,
  direction: "set" | "cancel",
  username: string,
  now: unknown,
): Record<string, unknown> =>
  direction === "set"
    ? {
        [cols.setAt]: now,
        [cols.setBy]: username,
        [cols.cancelledAt]: null,
        [cols.cancelledBy]: null,
      }
    : {
        [cols.setAt]: null,
        [cols.setBy]: null,
        [cols.cancelledAt]: now,
        [cols.cancelledBy]: username,
      };

/**
 * Memoised schema probe (module-level so the two endpoints share one answer).
 * Reset only exists for the unit tests that exercise both branches.
 */
let cascadeProbe: Promise<boolean> | null = null;

/**
 * Cumplimiento / anulación of a pedido, plus their cascades onto the pedido's
 * production orders.
 *
 * This DAO exists as a THIRD file (beside `sales-order.dao.ts` and
 * `production-order.dao.ts`) because one transition writes both tables inside
 * ONE transaction: putting it in either feature's DAO would make that feature
 * the owner of the other's table. Nothing here calls another DAO for a write —
 * the `production_orders` update is issued on this transaction's own handle, so
 * the cascade can never split into a second connection (plan R3).
 *
 * `SalesOrderDAO` is used for exactly one thing: the post-commit DTO read.
 */
export class SalesOrderLifecycleDAO {
  private tableName = "sales_orders";
  private productionOrdersTable = "production_orders";
  private salesOrderDAO = new SalesOrderDAO();

  /**
   * Is the pedido→OP link present in this deployment? Answers the L-007 branch
   * of `includeProductionOrders` (AC-18): with no link the flag is REJECTED,
   * never accepted and ignored.
   */
  async cascadeAvailable(): Promise<boolean> {
    if (!cascadeProbe) {
      cascadeProbe = (async () => {
        const knex = db("erp");
        if (!(await knex.schema.hasTable(this.productionOrdersTable))) {
          return false;
        }
        return knex.schema.hasColumn(this.productionOrdersTable, "orderDataId");
      })()
        // Only a SUCCESSFUL probe is memoised. A rejected promise cached for
        // the process lifetime would turn one connection blip at boot into a
        // permanent outage of both lifecycle verbs (every later call awaits the
        // same rejection, inside an already-open transaction) until a restart.
        .catch((err) => {
          cascadeProbe = null;
          throw err;
        });
    }
    return cascadeProbe;
  }

  /** Test seam: drops the memoised probe so both branches are reachable. */
  static resetCascadeProbe(): void {
    cascadeProbe = null;
  }

  // ── Cumplimiento ─────────────────────────────────────────────────────────
  /**
   * `fulfill` → stamp the pair; `cancel` → stamp its reversal. Both ALWAYS
   * cascade onto the pedido's production orders (Procusto passes no flag on
   * this path: PLSUseCases.Pedidos/Editar.cs:102, Listar.cs:64).
   *
   * A repeat/opposite action is a no-op: no column is written, not even
   * `updatedAt`, so the controller can tell "nothing happened" from "changed"
   * and skip the audit row (AC-3, AC-4).
   */
  async setFulfillment(
    id: number,
    action: FulfillmentAction,
    username: string,
  ): Promise<ILifecycleOutcome> {
    return this.runTransition(id, async (trx, row) => {
      if (action === "fulfill" && row.fulfilledAt != null) return null;
      if (action === "cancel" && row.fulfilledAt == null) return null;
      // No approval guard and no voided guard: Procusto reads neither
      // (Editar.cs:97-105, Listar.cs:56-68) — AC-7, AC-8.

      const now = trx.fn.now();
      const direction = action === "fulfill" ? "set" : "cancel";
      await trx(this.tableName)
        .where("id", id)
        .update({
          ...pairUpdate(FULFILLMENT_COLUMNS, direction, username, now),
          updatedAt: now,
        });

      const productionOrdersAffected = await this.cascade(
        trx,
        row.orderDataId,
        row.companyId,
        {
          columns: OP_COMPLETION_COLUMNS,
          direction,
          username,
          now,
          // Already-completed OPs are untouched on the way in, and only
          // completed ones are un-completed on the way out
          // (UseCases.Pedidos/Editar.cs:64-92).
          onlyWhenPairIs: direction === "set" ? "unset" : "set",
        },
      );
      return { productionOrdersAffected };
    });
  }

  // ── Anulación ────────────────────────────────────────────────────────────
  /**
   * `void` → stamp the pair; `cancel` → stamp its reversal. The cascade runs
   * ONLY with `includeProductionOrders` (PLSUseCases.Pedidos/Editar.cs:120-139).
   *
   * A fulfilled order cannot be voided (Listar.cs:72-75): reported as
   * `rejected`, which the controller answers 409 (divergence D-1).
   */
  async setVoid(
    id: number,
    action: VoidAction,
    username: string,
    includeProductionOrders: boolean,
  ): Promise<ILifecycleOutcome> {
    return this.runTransition(id, async (trx, row) => {
      if (action === "void" && row.fulfilledAt != null) {
        return { rejected: "ORDER_ALREADY_FULFILLED" as const };
      }
      if (action === "void" && row.voidedAt != null) return null;
      if (action === "cancel" && row.voidedAt == null) return null;

      const now = trx.fn.now();
      const direction = action === "void" ? "set" : "cancel";
      await trx(this.tableName)
        .where("id", id)
        .update({
          ...pairUpdate(VOID_COLUMNS, direction, username, now),
          updatedAt: now,
        });

      if (!includeProductionOrders) return { productionOrdersAffected: 0 };

      const productionOrdersAffected = await this.cascade(
        trx,
        row.orderDataId,
        row.companyId,
        {
          columns: OP_VOID_COLUMNS,
          direction,
          username,
          now,
          // MIRRORED PROCUSTO QUIRK (UseCases.Pedidos/Editar.cs:117-123): voiding
          // skips already-voided OPs, but the reversal iterates EVERY linked OP
          // unfiltered — including ones this pedido never voided. Do not "fix"
          // it; AC-17 pins it as parity.
          onlyWhenPairIs: direction === "set" ? "unset" : "any",
        },
      );
      return { productionOrdersAffected };
    });
  }

  // ── Automatic fulfillment (HandlerEventosPC.cs:35-46) ────────────────────
  /**
   * The pedido behind an `order_data` row, locked, plus the three aggregates
   * the rule needs. `sales_orders.orderDataId` is UNIQUE, so this is 1:1.
   *
   * `FOR UPDATE` is taken here for the same reason the manual path takes it:
   * the auto and manual writers must serialise on the order row, or one of them
   * loses its stamp (plan R1).
   *
   * L-009: the aggregate over `production_orders` carries the pedido's own
   * `companyId`, exactly as `cascade()` does. `orderDataId` alone is already
   * unambiguous, but which tenant's rows a statement touches must be readable
   * from its WHERE clause, not inferred from a constraint two tables away.
   */
  async findAutoFulfillCandidate(
    orderDataId: number,
    trx: any,
  ): Promise<IAutoFulfillCandidate | null> {
    const row = await trx(this.tableName)
      .where("orderDataId", orderDataId)
      .select("id", "uuid", "companyId", "quantity", "fulfilledAt")
      .forUpdate()
      .first();
    if (!row) return null;

    const aggregateQuery = trx(this.productionOrdersTable).where(
      "orderDataId",
      orderDataId,
    );
    if (row.companyId != null) aggregateQuery.where("companyId", row.companyId);
    const aggregate = await aggregateQuery
      .select(
        trx.raw('COUNT(*) as "opCount"'),
        trx.raw(
          'COUNT(*) FILTER (WHERE "completedAt" IS NULL) as "incompleteCount"',
        ),
        trx.raw('COALESCE(SUM("quantity"), 0) as "opQuantitySum"'),
      )
      .first();

    return {
      id: row.id,
      uuid: row.uuid,
      companyId: row.companyId ?? null,
      quantity: toNumberOut(row.quantity) ?? 0,
      fulfilledAt: row.fulfilledAt ?? null,
      opCount: Number(aggregate?.opCount ?? 0),
      incompleteCount: Number(aggregate?.incompleteCount ?? 0),
      opQuantitySum: Number(aggregate?.opQuantitySum ?? 0),
    };
  }

  /**
   * The system transition: the same four columns as `action:"fulfill"`, on the
   * CALLER's transaction and with NO cascade — every linked OP is already
   * complete by the rule's own precondition.
   *
   * `companyId` comes from the row `findAutoFulfillCandidate` locked and is a
   * second predicate for the same reason `cascade()` carries one (L-009).
   */
  async stampFulfillment(
    id: number,
    companyId: number | null,
    username: string,
    trx: any,
  ): Promise<void> {
    const now = trx.fn.now();
    const query = trx(this.tableName).where("id", id);
    if (companyId != null) query.where("companyId", companyId);
    await query
      .update({
        ...pairUpdate(FULFILLMENT_COLUMNS, "set", username, now),
        updatedAt: now,
      });
  }

  // ── Shared transition body ───────────────────────────────────────────────
  /**
   * Lock the order row, hand it to the caller's guard/write body, then read the
   * DTO back AFTER the commit (the in-transaction row is invisible to the
   * joined read `SalesOrderDAO.getByUuid` issues on its own connection).
   *
   * `body` returns null for a no-op — the transaction then commits having
   * written nothing at all.
   */
  private async runTransition(
    id: number,
    body: (
      trx: any,
      row: {
        id: number;
        uuid: string;
        companyId: number | null;
        orderDataId: number | null;
        fulfilledAt: Date | null;
        voidedAt: Date | null;
      },
    ) => Promise<{
      productionOrdersAffected?: number;
      rejected?: LifecycleRejection;
    } | null>,
  ): Promise<ILifecycleOutcome> {
    const knex = db("erp");
    const result = await knex.transaction(async (trx) => {
      // R1: re-read under the lock. Both the manual and the automatic writer
      // evaluate state on THIS row, so the second one sees the first's stamp
      // and no-ops instead of double-stamping.
      const row = await trx(this.tableName)
        .where("id", id)
        .select(
          "id",
          "uuid",
          "companyId",
          "orderDataId",
          "fulfilledAt",
          "voidedAt",
        )
        .forUpdate()
        .first();
      if (!row) {
        // Deleted between the controller's uuid→id resolution and this lock:
        // nothing was stamped, so the caller must see a 404 (see `missing`).
        return { uuid: null, changed: false, affected: 0, missing: true };
      }

      const outcome = await body(trx, row);
      if (!outcome) {
        return { uuid: row.uuid, changed: false, affected: 0 };
      }
      if (outcome.rejected) {
        return {
          uuid: row.uuid,
          changed: false,
          affected: 0,
          rejected: outcome.rejected,
        };
      }
      return {
        uuid: row.uuid,
        changed: true,
        affected: outcome.productionOrdersAffected ?? 0,
      };
    });

    return {
      changed: result.changed,
      ...(result.missing ? { missing: true } : {}),
      ...(result.rejected ? { rejected: result.rejected } : {}),
      productionOrdersAffected: result.affected,
      order: result.uuid
        ? await this.salesOrderDAO.getByUuid(result.uuid)
        : null,
    };
  }

  /**
   * One set-based UPDATE over every linked production order — never a row loop,
   * which is what keeps the lock window at milliseconds (plan R2). The join key
   * is `production_orders.orderDataId = sales_orders.orderDataId` (gate
   * decision Q-2).
   *
   * L-009: the pedido's own `companyId` is a second predicate. `orderDataId`
   * alone is already unambiguous (`sales_orders.orderDataId` is UNIQUE and OPs
   * inherit the tenant), but a cross-tenant write must be impossible by reading
   * the WHERE clause, not by tracing a constraint two tables away.
   */
  private async cascade(
    trx: any,
    orderDataId: number | null,
    companyId: number | null,
    options: {
      columns: PairColumns;
      direction: "set" | "cancel";
      username: string;
      now: unknown;
      onlyWhenPairIs: "set" | "unset" | "any";
    },
  ): Promise<number> {
    if (!orderDataId || !(await this.cascadeAvailable())) return 0;

    const query = trx(this.productionOrdersTable).where(
      "orderDataId",
      orderDataId,
    );
    if (companyId != null) query.where("companyId", companyId);
    if (options.onlyWhenPairIs === "unset") {
      query.whereNull(options.columns.setAt);
    } else if (options.onlyWhenPairIs === "set") {
      query.whereNotNull(options.columns.setAt);
    }

    return query.update({
      ...pairUpdate(
        options.columns,
        options.direction,
        options.username,
        options.now,
      ),
      updatedAt: options.now,
    });
  }
}
