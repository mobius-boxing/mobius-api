import { Router } from "express";
import { WarehouseController } from "../../controllers/warehouse/warehouse.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class WarehouseRouter {
  public router: Router = Router();
  private readonly warehouseController: WarehouseController =
    new WarehouseController();

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
      this.warehouseController.getAll.bind(this.warehouseController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.warehouseController.getByUuid.bind(this.warehouseController),
    );
    this.router.get(
      "/:uuid/stock",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.warehouseController.getWarehouseStock.bind(this.warehouseController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.warehouseController.create.bind(this.warehouseController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.warehouseController.update.bind(this.warehouseController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.warehouseController.delete.bind(this.warehouseController),
    );
  }
}
