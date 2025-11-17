import { Router } from "express";
import { PaperSupplyController } from "../../controllers/paper-supply/paper-supply.controller";
import {
  authenticate,
  requireAdmin,
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
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.paperSupplyController.getAll.bind(this.paperSupplyController),
    );
    this.router.get(
      "/:uuid/with-details",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperSupplyController.getWithDetails.bind(
        this.paperSupplyController,
      ),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperSupplyController.getByUuid.bind(this.paperSupplyController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.paperSupplyController.create.bind(this.paperSupplyController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.paperSupplyController.update.bind(this.paperSupplyController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitivePaperSupplyDeletionRateLimiter,
      this.paperSupplyController.delete.bind(this.paperSupplyController),
    );
  }
}
