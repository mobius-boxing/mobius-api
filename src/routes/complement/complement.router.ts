import { Router } from "express";
import { ComplementController } from "../../controllers/complement/complement.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveComplementDeletionRateLimiter,
} from "../../middlewares";

export class ComplementRouter {
  public router: Router = Router();
  private readonly complementController: ComplementController =
    new ComplementController();

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
      this.complementController.getAll.bind(this.complementController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.complementController.getByUuid.bind(this.complementController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.complementController.create.bind(this.complementController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.complementController.update.bind(this.complementController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveComplementDeletionRateLimiter,
      this.complementController.delete.bind(this.complementController),
    );
  }
}
