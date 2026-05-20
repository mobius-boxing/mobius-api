import { Router } from "express";
import { StoreOrdersController } from "../../controllers/store-orders/store-orders.controller";
import {
  authenticate,
  requireAdmin,
  requireStoreModule,
  validateUUID,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";

export class StoreOrdersRouter {
  public router: Router = Router();
  private readonly controller: StoreOrdersController = new StoreOrdersController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    const c = this.controller;

    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validatePagination,
      apiRateLimiter,
      c.getAll.bind(c),
    );

    // literal suffix before /:uuid (project's defensive route-ordering habit)
    this.router.put(
      "/:uuid/status",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      c.updateStatus.bind(c),
    );

    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      c.getByUuid.bind(c),
    );
  }
}
