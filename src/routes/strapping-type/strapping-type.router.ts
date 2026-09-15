import { Router } from "express";
import { StrappingTypeController } from "../../controllers/strapping-type/strapping-type.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveStrappingTypeDeletionRateLimiter,
} from "../../middlewares";

export class StrappingTypeRouter {
  public router: Router = Router();
  private readonly strappingTypeController: StrappingTypeController =
    new StrappingTypeController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("strapping-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.strappingTypeController.getAll.bind(this.strappingTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("strapping-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.strappingTypeController.getByUuid.bind(this.strappingTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("strapping-types.edit"),
      apiRateLimiter,
      this.strappingTypeController.create.bind(this.strappingTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("strapping-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.strappingTypeController.update.bind(this.strappingTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("strapping-types.edit"),
      validateUUID(),
      sensitiveStrappingTypeDeletionRateLimiter,
      this.strappingTypeController.delete.bind(this.strappingTypeController),
    );
  }
}
