import { Knex } from "knex";
import { SalesOrderLifecycleDAO } from "../dao/sales-order/sales-order-lifecycle.dao";

/** What the caller learns: did this OP completion fulfill the pedido? */
export interface IAutoFulfillResult {
  fulfilled: boolean;
  salesOrderUuid: string | null;
}

const NOT_FULFILLED: IAutoFulfillResult = Object.freeze({
  fulfilled: false,
  salesOrderUuid: null,
});

const lifecycleDAO = new SalesOrderLifecycleDAO();

/**
 * Procusto's automatic pedido fulfillment
 * (`PLS_Events.EventosPC/HandlerEventosPC.cs:20-52`): when a production order is
 * completed, the pedido behind it becomes cumplido iff
 *
 *   1. the pedido exists and is not already fulfilled (`:35`),
 *   2. it has at least one production order (`:38-39`),
 *   3. the OPs' quantities cover the pedido's quantity (`:40`,
 *      `!(num < pedido.Cantidad)` — plain IEEE-754 `<`, no epsilon, L-010),
 *   4. every one of those OPs is complete (`:40`).
 *
 * NOT permission-gated: this is a system transition, and the
 * `orders.manual-fulfillment` code gates only the button (spec §Open questions
 * (e)). No cascade either — every linked OP is already complete by rule 4.
 * The audit row is the CALLER's job, after its commit (spec §Audit).
 *
 * Failures are swallowed and logged, never propagated (`:48-51`). Because the
 * caller's transaction has already persisted the OP completion, the work runs
 * inside `trx.transaction(...)` — a SAVEPOINT — so a rollback here leaves the
 * outer transaction usable instead of poisoning it (Postgres 25P02).
 *
 * "Swallowed" is not "silent". This path and the manual one lock the same two
 * tables, so a deadlock (40P01) or serialisation failure (40001) is a real
 * possibility; it is retried ONCE on a fresh savepoint. Anything still failing
 * after that is logged at error level WITH the `orderDataId`, because there is
 * no reverse event in Procusto: once every OP is complete nothing will call
 * this again, and the lost roll-up is only recoverable if it was named.
 *
 * `trx` is REQUIRED: this module opens no connection of its own (the
 * architecture check keeps `database/registry` out of `src/services`), so every
 * statement goes through `SalesOrderLifecycleDAO` on the caller's handle.
 *
 * The parameter is `orderDataId`, not a pedido id: the resolution chain fixed
 * by gate decision Q-2 is
 * `production_orders.orderDataId → order_data(id) ← sales_orders.orderDataId`
 * (1:1), and the completion path only ever holds the OP's `orderDataId`.
 */
export async function autoFulfillIfComplete(
  orderDataId: number | null | undefined,
  username: string,
  trx: Knex.Transaction,
): Promise<IAutoFulfillResult> {
  if (!orderDataId) return NOT_FULFILLED;

  try {
    return await runRollUp(orderDataId, username, trx);
  } catch (err) {
    if (isSerialisationFailure(err)) {
      // A deadlock or serialisation failure is the one error worth retrying:
      // the savepoint rolled back, the OUTER transaction is intact, and the
      // writer we lost to has committed by the time we get here — so the retry
      // reads its stamp and either no-ops or completes the roll-up.
      try {
        return await runRollUp(orderDataId, username, trx);
      } catch (retryErr) {
        return reportDroppedRollUp(orderDataId, retryErr);
      }
    }
    return reportDroppedRollUp(orderDataId, err);
  }
}

/** The rule itself, inside its own SAVEPOINT so a failure is retryable. */
function runRollUp(
  orderDataId: number,
  username: string,
  trx: Knex.Transaction,
): Promise<IAutoFulfillResult> {
  return trx.transaction(async (savepoint) => {
    const candidate = await lifecycleDAO.findAutoFulfillCandidate(
      orderDataId,
      savepoint,
    );
    if (!candidate) return NOT_FULFILLED;
    // :35 — an already-fulfilled pedido is never re-stamped.
    if (candidate.fulfilledAt != null) return NOT_FULFILLED;
    // :38-39 — a pedido with no orders is not fulfilled by this rule.
    if (candidate.opCount === 0) return NOT_FULFILLED;
    // :40 — every order complete, and their quantities cover the pedido.
    if (candidate.incompleteCount > 0) return NOT_FULFILLED;
    if (candidate.opQuantitySum < candidate.quantity) return NOT_FULFILLED;

    // The tenant travels with the candidate: the stamp predicates on the same
    // `companyId` the locked read returned (L-009, symmetric with `cascade()`).
    await lifecycleDAO.stampFulfillment(
      candidate.id,
      candidate.companyId,
      username,
      savepoint,
    );
    return { fulfilled: true, salesOrderUuid: candidate.uuid };
  });
}

/** Postgres 40P01 deadlock_detected / 40001 serialization_failure. */
function isSerialisationFailure(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === "40P01" || code === "40001";
}

/**
 * HandlerEventosPC.cs:48-51 — the OP completion must not fail because the
 * roll-up did. It must not fail SILENTLY either: Procusto has no reverse event,
 * so once every OP of this pedido is complete nothing will ever call this again
 * and the pedido stays uncumplido until someone fulfills it by hand. The
 * `orderDataId` is logged at error level so exactly that pedido is recoverable.
 */
function reportDroppedRollUp(
  orderDataId: number,
  err: unknown,
): IAutoFulfillResult {
  console.error(
    `[sales-order] automatic fulfillment DROPPED for orderDataId=${orderDataId}; ` +
      `the pedido stays uncumplido and no further event will retry it`,
    err,
  );
  return NOT_FULFILLED;
}
