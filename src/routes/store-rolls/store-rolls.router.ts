import { Router } from "express";
import { StoreRollController } from "../../controllers/store-roll/store-roll.controller";
import {
  authenticate,
  requireAdmin,
  requireStoreModule,
  validateUUID,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";

export class StoreRollsRouter {
  public router: Router = Router();
  private readonly controller: StoreRollController = new StoreRollController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
