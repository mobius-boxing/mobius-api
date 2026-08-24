import { Router } from "express";
import { ProductionOrderController } from "../../controllers/production-order/production-order.controller";
import {
  LifecycleAction,
  LifecycleMachine,
} from "../../interfaces/production-order/production-order.interfaces";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";
import { sensitiveProductionOrderDeletionRateLimiter } from "../../middlewares/rate-limit.middleware";

/** Catalogue codes; both already ship in permissions-catalog.ts. */
const EDIT = "production-orders.edit";
const GENERATE = "production-orders.generate";

/**
 * `/:uuid/<path>` → the machine and action it stamps. Manual creation and
 * generation are gated by GENERATE, everything else by EDIT — parity with
 * OrdenesDeProduccionForm.cs:155, where the "Agregar" button asks for the
 * generation permission and the grid's edit actions do not.
 */
const LIFECYCLE_ROUTES: Array<{
  path: string;
  machine: LifecycleMachine;
  action: LifecycleAction;
}> = [
  { path: "/:uuid/enable", machine: "scheduling", action: "set" },
  { path: "/:uuid/disable", machine: "scheduling", action: "cancel" },
  { path: "/:uuid/complete", machine: "completion", action: "set" },
  { path: "/:uuid/complete/cancel", machine: "completion", action: "cancel" },
  { path: "/:uuid/void", machine: "void", action: "set" },
  { path: "/:uuid/void/cancel", machine: "void", action: "cancel" },
];

/**
 * Órdenes de producción routes (module 13). Every route authenticates and is
 * gated by a catalogue permission — never `requireAdmin()` and never an inline
 * superAdmin check.
 *
 * Route ORDER matters: `/generation-eligibility` and `/generate` are registered
 * before `/:uuid`, or Express captures the literals as a uuid and `validateUUID`
 * answers 400 for a perfectly good request.
 *
 * DELETE gets its OWN bucket (`sensitiveProductionOrderDeletionRateLimiter`,
 * 10 per 5 min), like every other entity's destructive verb — not the shared
 * `sensitiveRateLimiter`, whose 3 per 5 minutes across ALL sensitive routes is
 * meant for irreversible master-data deletion and would make the routine
 * cleanup of these high-volume operational rows (and test teardown) unusable.
 * This supersedes the earlier "DELETE uses apiRateLimiter" note: per the spec's
 * gate addendum (spec.md §Gate decisions — addendum), destructive verbs take a
 * dedicated bucket rather than the plain API limiter.
 */
export class ProductionOrdersRouter {
  public router: Router = Router();
  private readonly controller: ProductionOrderController =
    new ProductionOrderController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission(EDIT),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/generation-eligibility",
      authenticate,
      requirePermission(GENERATE),
      apiRateLimiter,
      this.controller.generationEligibility.bind(this.controller),
    );
    this.router.post(
      "/generate",
      authenticate,
      requirePermission(GENERATE),
      apiRateLimiter,
      this.controller.generate.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission(GENERATE),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission(EDIT),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission(EDIT),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission(EDIT),
      validateUUID(),
      sensitiveProductionOrderDeletionRateLimiter,
      this.controller.delete.bind(this.controller),
    );

    // The six lifecycle verbs. No request body on any of them.
    for (const route of LIFECYCLE_ROUTES) {
      this.router.post(
        route.path,
        authenticate,
        requirePermission(EDIT),
        validateUUID(),
        apiRateLimiter,
        this.controller.lifecycle(route.machine, route.action),
      );
    }
  }
}
