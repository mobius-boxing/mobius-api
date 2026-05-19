import { Router } from "express";
import { StrappingTypeController } from "../../controllers/strapping-type/strapping-type.controller";
import {
  authenticate,
  requireAdmin,
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
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.strappingTypeController.getAll.bind(this.strappingTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.strappingTypeController.getByUuid.bind(this.strappingTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.strappingTypeController.create.bind(this.strappingTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.strappingTypeController.update.bind(this.strappingTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveStrappingTypeDeletionRateLimiter,
      this.strappingTypeController.delete.bind(this.strappingTypeController),
    );
  }
}
