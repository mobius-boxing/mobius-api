import { Router } from "express";
import { GlueTypeController } from "../../controllers/glue-type/glue-type.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveGlueTypeDeletionRateLimiter,
} from "../../middlewares";

export class GlueTypeRouter {
  public router: Router = Router();
  private readonly glueTypeController: GlueTypeController =
    new GlueTypeController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("glue-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.glueTypeController.getAll.bind(this.glueTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("glue-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.glueTypeController.getByUuid.bind(this.glueTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("glue-types.edit"),
      apiRateLimiter,
      this.glueTypeController.create.bind(this.glueTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("glue-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.glueTypeController.update.bind(this.glueTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("glue-types.edit"),
      validateUUID(),
      sensitiveGlueTypeDeletionRateLimiter,
      this.glueTypeController.delete.bind(this.glueTypeController),
    );
  }
}
