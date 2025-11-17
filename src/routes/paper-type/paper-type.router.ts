import { Router } from "express";
import { PaperTypeController } from "../../controllers/paper-type/paper-type.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class PaperTypeRouter {
  public router: Router = Router();
  private readonly paperTypeController: PaperTypeController =
    new PaperTypeController();

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
      this.paperTypeController.getAll.bind(this.paperTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperTypeController.getByUuid.bind(this.paperTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.paperTypeController.create.bind(this.paperTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperTypeController.update.bind(this.paperTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.paperTypeController.delete.bind(this.paperTypeController),
    );
  }
}
