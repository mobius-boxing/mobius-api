import { Router } from "express";
import { ToolingTypeController } from "../../controllers/tooling-type/tooling-type.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("tooling-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.toolingTypeController.getAll.bind(this.toolingTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("tooling-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.toolingTypeController.getByUuid.bind(this.toolingTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("tooling-types.edit"),
      apiRateLimiter,
      this.toolingTypeController.create.bind(this.toolingTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("tooling-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.toolingTypeController.update.bind(this.toolingTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("tooling-types.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.toolingTypeController.delete.bind(this.toolingTypeController),
    );
  }
}
