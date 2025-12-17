import { Router } from "express";
import { CorrugationController } from "../../controllers/corrugation/corrugation.controller";
import {
  authenticate,
  requireAdmin,
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
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.corrugationController.getAll.bind(this.corrugationController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.corrugationController.getByUuid.bind(this.corrugationController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.corrugationController.create.bind(this.corrugationController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.corrugationController.update.bind(this.corrugationController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.corrugationController.delete.bind(this.corrugationController),
    );
  }
}
