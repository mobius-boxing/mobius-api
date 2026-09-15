import { Router } from "express";
import { PaperTypeController } from "../../controllers/paper-type/paper-type.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("paper-types.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.paperTypeController.getAll.bind(this.paperTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("paper-types.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.paperTypeController.getByUuid.bind(this.paperTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("paper-types.edit"),
      apiRateLimiter,
      this.paperTypeController.create.bind(this.paperTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("paper-types.edit"),
      validateUUID(),
      apiRateLimiter,
      this.paperTypeController.update.bind(this.paperTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("paper-types.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.paperTypeController.delete.bind(this.paperTypeController),
    );
  }
}
