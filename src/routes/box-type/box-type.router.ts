import { Router } from "express";
import { BoxTypeController } from "../../controllers/box-type/box-type.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveBoxTypeDeletionRateLimiter,
} from "../../middlewares";

export class BoxTypeRouter {
  public router: Router = Router();
  private readonly controller: BoxTypeController =
    new BoxTypeController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("box-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("box-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("box-types.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("box-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("box-types.edit"),
      validateUUID(),
      sensitiveBoxTypeDeletionRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
