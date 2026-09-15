import { Router } from "express";
import { CorrugationController } from "../../controllers/corrugation/corrugation.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class CorrugationRouter {
  public router: Router = Router();
  private readonly corrugationController: CorrugationController =
    new CorrugationController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("corrugated.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.corrugationController.getAll.bind(this.corrugationController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("corrugated.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.corrugationController.getByUuid.bind(this.corrugationController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("corrugated.edit"),
      apiRateLimiter,
      this.corrugationController.create.bind(this.corrugationController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("corrugated.edit"),
      validateUUID(),
      apiRateLimiter,
      this.corrugationController.update.bind(this.corrugationController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("corrugated.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.corrugationController.delete.bind(this.corrugationController),
    );
  }
}
