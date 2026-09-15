import { Router } from "express";
import { FlapTypeController } from "../../controllers/flap-type/flap-type.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class FlapTypeRouter {
  public router: Router = Router();
  private readonly flapTypeController: FlapTypeController =
    new FlapTypeController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("flap-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.flapTypeController.getAll.bind(this.flapTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("flap-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.flapTypeController.getByUuid.bind(this.flapTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("flap-types.edit"),
      apiRateLimiter,
      this.flapTypeController.create.bind(this.flapTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("flap-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.flapTypeController.update.bind(this.flapTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("flap-types.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.flapTypeController.delete.bind(this.flapTypeController),
    );
  }
}
