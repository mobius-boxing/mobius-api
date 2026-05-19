import { Router } from "express";
import { GlueTypeController } from "../../controllers/glue-type/glue-type.controller";
import {
  authenticate,
  requireAdmin,
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
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.glueTypeController.getAll.bind(this.glueTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.glueTypeController.getByUuid.bind(this.glueTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.glueTypeController.create.bind(this.glueTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.glueTypeController.update.bind(this.glueTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveGlueTypeDeletionRateLimiter,
      this.glueTypeController.delete.bind(this.glueTypeController),
    );
  }
}
