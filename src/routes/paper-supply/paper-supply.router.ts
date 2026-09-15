import { Router } from "express";
import { PaperSupplyController } from "../../controllers/paper-supply/paper-supply.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitivePaperSupplyDeletionRateLimiter,
} from "../../middlewares";

export class PaperSupplyRouter {
  public router: Router = Router();
  private readonly paperSupplyController: PaperSupplyController =
    new PaperSupplyController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("supplies.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.paperSupplyController.getAll.bind(this.paperSupplyController),
    );
    this.router.get(
      "/:uuid/with-details",
      authenticate,
      requirePermission("supplies.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.paperSupplyController.getWithDetails.bind(
        this.paperSupplyController,
      ),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("supplies.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.paperSupplyController.getByUuid.bind(this.paperSupplyController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("supplies.edit"),
      apiRateLimiter,
      this.paperSupplyController.create.bind(this.paperSupplyController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("supplies.edit"),
      validateUUID(),
      apiRateLimiter,
      this.paperSupplyController.update.bind(this.paperSupplyController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("supplies.edit"),
      validateUUID(),
      sensitivePaperSupplyDeletionRateLimiter,
      this.paperSupplyController.delete.bind(this.paperSupplyController),
    );
  }
}
