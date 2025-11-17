import { Router } from "express";
import { ManufacturerController } from "../../controllers/manufacturer/manufacturer.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class ManufacturerRouter {
  public router: Router = Router();
  private readonly manufacturerController: ManufacturerController =
    new ManufacturerController();

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
      this.manufacturerController.getAll.bind(this.manufacturerController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.manufacturerController.getByUuid.bind(this.manufacturerController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.manufacturerController.create.bind(this.manufacturerController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.manufacturerController.update.bind(this.manufacturerController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.manufacturerController.delete.bind(this.manufacturerController),
    );
  }
}
