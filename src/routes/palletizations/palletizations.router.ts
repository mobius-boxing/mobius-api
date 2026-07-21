import { Router } from "express";
import { PalletizationController } from "../../controllers/palletization/palletization.controller";
import {
  authenticate,
  requireAdmin,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class PalletizationsRouter {
  public router: Router = Router();
  private readonly controller: PalletizationController =
    new PalletizationController();

  constructor() {
    this.initRoutes();
  }

  // Writes gated by the RBAC catalogue code (reads stay admin-gated,
  // mirroring parts.router).
  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("palletizing.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("palletizing.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("palletizing.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
