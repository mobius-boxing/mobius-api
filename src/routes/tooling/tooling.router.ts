import { Router } from "express";
import { ToolingController } from "../../controllers/tooling/tooling.controller";
import {
  authenticate,
  requireAdmin,
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
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.toolingController.getAll.bind(this.toolingController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.toolingController.getByUuid.bind(this.toolingController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.toolingController.create.bind(this.toolingController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.toolingController.update.bind(this.toolingController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.toolingController.delete.bind(this.toolingController),
    );
  }
}
