import { Router } from "express";
import { CorrugationClassController } from "../../controllers/corrugation-class/corrugation-class.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class CorrugationClassRouter {
  public router: Router = Router();
  private readonly corrugationClassController: CorrugationClassController =
    new CorrugationClassController();

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
      this.corrugationClassController.getAll.bind(this.corrugationClassController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.corrugationClassController.getByUuid.bind(this.corrugationClassController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.corrugationClassController.create.bind(this.corrugationClassController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.corrugationClassController.update.bind(this.corrugationClassController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.corrugationClassController.delete.bind(this.corrugationClassController),
    );
  }
}
