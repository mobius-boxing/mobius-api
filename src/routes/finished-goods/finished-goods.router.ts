import { Router } from "express";
import { FinishedGoodController } from "../../controllers/finished-good/finished-good.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class FinishedGoodsRouter {
  public router: Router = Router();
  private readonly controller: FinishedGoodController =
    new FinishedGoodController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("finished-goods.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("finished-goods.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("finished-goods.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("finished-goods.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("finished-goods.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
