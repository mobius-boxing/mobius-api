import { Router } from "express";
import { PaperClassController } from "../../controllers/paper-class/paper-class.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("paper.classes", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.paperClassController.getAll.bind(this.paperClassController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("paper.classes", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.paperClassController.getByUuid.bind(this.paperClassController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("paper.classes"),
      apiRateLimiter,
      this.paperClassController.create.bind(this.paperClassController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("paper.classes"),
      validateUUID(),
      apiRateLimiter,
      this.paperClassController.update.bind(this.paperClassController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("paper.classes"),
      validateUUID(),
      sensitiveRateLimiter,
      this.paperClassController.delete.bind(this.paperClassController),
    );
  }
}
