import { Router } from "express";
import { FluteTypeController } from "../../controllers/flute-type/flute-type.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class FluteTypeRouter {
  public router: Router = Router();
  private readonly fluteTypeController: FluteTypeController =
    new FluteTypeController();

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
      this.fluteTypeController.getAll.bind(this.fluteTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.fluteTypeController.getByUuid.bind(this.fluteTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.fluteTypeController.create.bind(this.fluteTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.fluteTypeController.update.bind(this.fluteTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.fluteTypeController.delete.bind(this.fluteTypeController),
    );
  }
}
