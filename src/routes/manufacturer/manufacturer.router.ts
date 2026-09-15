import { Router } from "express";
import { ManufacturerController } from "../../controllers/manufacturer/manufacturer.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("manufacturers.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.manufacturerController.getAll.bind(this.manufacturerController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("manufacturers.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.manufacturerController.getByUuid.bind(this.manufacturerController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("manufacturers.edit"),
      apiRateLimiter,
      this.manufacturerController.create.bind(this.manufacturerController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("manufacturers.edit"),
      validateUUID(),
      apiRateLimiter,
      this.manufacturerController.update.bind(this.manufacturerController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("manufacturers.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.manufacturerController.delete.bind(this.manufacturerController),
    );
  }
}
