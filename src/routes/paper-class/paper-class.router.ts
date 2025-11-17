import { Router } from "express";
import { PaperClassController } from "../../controllers/paper-class/paper-class.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class PaperClassRouter {
  public router: Router = Router();
  private readonly paperClassController: PaperClassController =
    new PaperClassController();

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
      this.paperClassController.getAll.bind(this.paperClassController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperClassController.getByUuid.bind(this.paperClassController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.paperClassController.create.bind(this.paperClassController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperClassController.update.bind(this.paperClassController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.paperClassController.delete.bind(this.paperClassController),
    );
  }
}
