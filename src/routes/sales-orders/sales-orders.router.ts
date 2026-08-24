import { Router } from "express";
import { SalesOrderController } from "../../controllers/sales-order/sales-order.controller";
import {
  ORDER_APPROVAL_MACHINES,
  orderApprovalPermissionCode,
} from "../../interfaces/sales-order/sales-order-approval.interfaces";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";
// Imported from the module rather than the `middlewares` barrel: re-exporting
// it there is a one-line change to a file this feature does not own.
import { sensitiveSalesOrderVoidRateLimiter } from "../../middlewares/rate-limit.middleware";

/**
 * Pedidos routes (module 18 sub-area D). Reads and writes alike are gated by
 * the pre-existing `orders.edit` catalogue code, deletion by `orders.delete`.
 *
 * All THREE reads — the list, the single pedido and the nested OP table — share
 * `orders.edit` (spec.md §Gate decisions — addendum). Gating the parent with
 * `requireAdmin()` and the nested table with a permission code left the
 * resource inconsistently gated: a non-admin holding `orders.edit` loaded the
 * OP table underneath a pedido whose own fetch answered 403.
 *
 * The field-level codes (`orders.edit-prices`, `orders.view-sales-sector`,
 * `orders.edit-delivery-date`) cannot be route middleware — they depend on
 * which keys the body carries — so the controller consults RbacService for
 * those. The approval route below is gated per `:machine` by its own
 * `orders.approve.*` code; cumplimiento is gated by
 * `orders.manual-fulfillment` and anulación — the pedido's soft delete — by
 * `orders.delete`.
 */
export class SalesOrdersRouter {
  public router: Router = Router();
  private readonly controller: SalesOrderController =
    new SalesOrderController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("orders.edit"),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    // Registered BEFORE `/:uuid` — Express matches in order, and the nested
    // literal must not be captured as part of a uuid path.
    //
    // Gated by the pedido's own catalogue code, never `requireAdmin()`: the
    // screen this serves is opened from the pedido grid (PedidosForm.cs:335),
    // where Procusto asks for no separate permission at all. Reading a pedido's
    // OPs is therefore part of working with pedidos, exactly as
    // `GET /production-orders` is gated by `production-orders.edit`, and it is
    // the same gate the two parent reads above use.
    this.router.get(
      "/:uuid/production-orders",
      authenticate,
      requirePermission("orders.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.getProductionOrders.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("orders.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("orders.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("orders.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    // Machine-specific approval gate: dispatch to the right catalogue code.
    // DELIBERATE DIVERGENCE from parts.router.ts:90-92, which falls back to
    // `parts.approve.part` for an unknown machine. Here an unknown machine is
    // answered 400 BEFORE requirePermission runs and before any DB access, as
    // the spec's response table requires; a fallback would turn it into a 403
    // (or, for a privileged caller, a 200 on the wrong machine).
    this.router.patch(
      "/:uuid/approval/:machine",
      authenticate,
      (req, res, next) => {
        const code = orderApprovalPermissionCode(String(req.params.machine));
        if (!code) {
          res.status(400).json({
            success: false,
            message: `machine must be one of: ${ORDER_APPROVAL_MACHINES.join(", ")}`,
          });
          return;
        }
        requirePermission(code)(req, res, next);
      },
      validateUUID(),
      apiRateLimiter,
      this.controller.setApproval.bind(this.controller),
    );
    // Cumplimiento (manual) and anulación. Cumplimiento is a pair-stamping
    // PATCH like the approval route above, so it takes `apiRateLimiter`.
    // Anulación IS the pedido's soft delete, so it takes a deletion-shaped
    // bucket of its OWN (10 per 5 min), like every other entity's delete —
    // never the generic 3-per-5-minutes `sensitiveRateLimiter`, which is shared
    // across every sensitive route and would 429 a clerk voiding a fourth
    // pedido. `sensitiveRateLimiter` stays on the irreversible hard DELETE.
    this.router.patch(
      "/:uuid/fulfillment",
      authenticate,
      requirePermission("orders.manual-fulfillment"),
      validateUUID(),
      apiRateLimiter,
      this.controller.setFulfillment.bind(this.controller),
    );
    this.router.patch(
      "/:uuid/void",
      authenticate,
      requirePermission("orders.delete"),
      validateUUID(),
      sensitiveSalesOrderVoidRateLimiter,
      this.controller.setVoid.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("orders.delete"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
