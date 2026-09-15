import { Router } from "express";
import { ToolingController } from "../../controllers/tooling/tooling.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class ToolingRouter {
  public router: Router = Router();
  private readonly toolingController: ToolingController =
    new ToolingController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("tooling.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.toolingController.getAll.bind(this.toolingController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("tooling.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.toolingController.getByUuid.bind(this.toolingController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("tooling.edit"),
      apiRateLimiter,
      this.toolingController.create.bind(this.toolingController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("tooling.edit"),
      validateUUID(),
      apiRateLimiter,
      this.toolingController.update.bind(this.toolingController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("tooling.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.toolingController.delete.bind(this.toolingController),
    );
  }
}
