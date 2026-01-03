import { Router } from "express";
import { ToolingTypeController } from "../../controllers/tooling-type/tooling-type.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class ToolingTypeRouter {
  public router: Router = Router();
  private readonly toolingTypeController: ToolingTypeController =
    new ToolingTypeController();

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
      this.toolingTypeController.getAll.bind(this.toolingTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.toolingTypeController.getByUuid.bind(this.toolingTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.toolingTypeController.create.bind(this.toolingTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.toolingTypeController.update.bind(this.toolingTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.toolingTypeController.delete.bind(this.toolingTypeController),
    );
  }
}
