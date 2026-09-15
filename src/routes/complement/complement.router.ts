import { Router } from "express";
import { ComplementController } from "../../controllers/complement/complement.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("complements.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.complementController.getAll.bind(this.complementController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("complements.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.complementController.getByUuid.bind(this.complementController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("complements.edit"),
      apiRateLimiter,
      this.complementController.create.bind(this.complementController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("complements.edit"),
      validateUUID(),
      apiRateLimiter,
      this.complementController.update.bind(this.complementController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("complements.edit"),
      validateUUID(),
      sensitiveComplementDeletionRateLimiter,
      this.complementController.delete.bind(this.complementController),
    );
  }
}
