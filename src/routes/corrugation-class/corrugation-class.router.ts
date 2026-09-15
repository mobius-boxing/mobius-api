import { Router } from "express";
import { CorrugationClassController } from "../../controllers/corrugation-class/corrugation-class.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("corrugated.classes", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.corrugationClassController.getAll.bind(
        this.corrugationClassController,
      ),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("corrugated.classes", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.corrugationClassController.getByUuid.bind(
        this.corrugationClassController,
      ),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("corrugated.classes"),
      apiRateLimiter,
      this.corrugationClassController.create.bind(
        this.corrugationClassController,
      ),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("corrugated.classes"),
      validateUUID(),
      apiRateLimiter,
      this.corrugationClassController.update.bind(
        this.corrugationClassController,
      ),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("corrugated.classes"),
      validateUUID(),
      sensitiveRateLimiter,
      this.corrugationClassController.delete.bind(
        this.corrugationClassController,
      ),
    );
  }
}
