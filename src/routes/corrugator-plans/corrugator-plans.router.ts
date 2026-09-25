import { Router } from "express";
import { CorrugatorPlanController } from "../../controllers/corrugator-plan/corrugator-plan.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  apiRateLimiter,
} from "../../middlewares";

const PLAN = "corrugator.plan";
const REGISTER = "corrugator.register";

/**
 * `/api/corrugator-plans` (model.md §API contracts). Route ORDER matters:
 * `/pool` is registered before `/:uuid`, or Express/`validateUUID` would
 * capture it as a malformed uuid (production-orders.router.ts precedent).
 */
export class CorrugatorPlansRouter {
  public router: Router = Router();
  private readonly controller = new CorrugatorPlanController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/pool",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      apiRateLimiter,
      this.controller.getPool.bind(this.controller),
    );
    this.router.get(
      "/",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission(PLAN),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      this.controller.delete.bind(this.controller),
    );

    this.router.post(
      "/:uuid/orders",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      this.controller.addOrders.bind(this.controller),
    );
    this.router.put(
      "/:uuid/orders/:orderUuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      validateUUID("orderUuid"),
      apiRateLimiter,
      this.controller.updateOrder.bind(this.controller),
    );
    this.router.delete(
      "/:uuid/orders/:orderUuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      validateUUID("orderUuid"),
      apiRateLimiter,
      this.controller.deleteOrder.bind(this.controller),
    );

    this.router.post(
      "/:uuid/solve",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      this.controller.solve.bind(this.controller),
    );
    this.router.post(
      "/:uuid/cancel-solve",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      this.controller.cancelSolve.bind(this.controller),
    );
    this.router.get(
      "/:uuid/candidates",
      authenticate,
      requirePermission(PLAN, { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.controller.candidates.bind(this.controller),
    );

    this.router.post(
      "/:uuid/combinations",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      apiRateLimiter,
      this.controller.addCombination.bind(this.controller),
    );
    this.router.put(
      "/:uuid/combinations/:cuuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      validateUUID("cuuid"),
      apiRateLimiter,
      this.controller.updateCombination.bind(this.controller),
    );
    this.router.delete(
      "/:uuid/combinations/:cuuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      validateUUID("cuuid"),
      apiRateLimiter,
      this.controller.deleteCombination.bind(this.controller),
    );
    this.router.delete(
      "/:uuid/combinations/:cuuid/items/:iuuid",
      authenticate,
      requirePermission(PLAN),
      validateUUID(),
      validateUUID("cuuid"),
      validateUUID("iuuid"),
      apiRateLimiter,
      this.controller.deleteItem.bind(this.controller),
    );

    this.router.post(
      "/:uuid/register",
      authenticate,
      requirePermission(REGISTER),
      validateUUID(),
      apiRateLimiter,
      this.controller.register.bind(this.controller),
    );
    this.router.post(
      "/:uuid/unregister",
      authenticate,
      requirePermission(REGISTER),
      validateUUID(),
      apiRateLimiter,
      this.controller.unregister.bind(this.controller),
    );
  }
}
