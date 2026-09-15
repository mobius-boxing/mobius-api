import { Router } from "express";
import { FluteTypeController } from "../../controllers/flute-type/flute-type.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class FluteTypeRouter {
  public router: Router = Router();
  private readonly fluteTypeController: FluteTypeController =
    new FluteTypeController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("flute-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.fluteTypeController.getAll.bind(this.fluteTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("flute-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.fluteTypeController.getByUuid.bind(this.fluteTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("flute-types.edit"),
      apiRateLimiter,
      this.fluteTypeController.create.bind(this.fluteTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("flute-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.fluteTypeController.update.bind(this.fluteTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("flute-types.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.fluteTypeController.delete.bind(this.fluteTypeController),
    );
  }
}
