import { Router } from "express";
import { ProductionRouteController } from "../../controllers/production-route/production-route.controller";
import {
  authenticate,
  requireAdmin,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class ProductionRoutesRouter {
  public router: Router = Router();
  private readonly controller: ProductionRouteController =
    new ProductionRouteController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("routes.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("routes.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.post(
      "/:uuid/clone",
      authenticate,
      requirePermission("routes.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.clone.bind(this.controller),
    );
    this.router.post(
      "/:uuid/copy-stages",
      authenticate,
      requirePermission("routes.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.copyStages.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("routes.delete"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
