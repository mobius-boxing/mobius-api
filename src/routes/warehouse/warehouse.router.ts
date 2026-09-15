import { Router } from "express";
import { WarehouseController } from "../../controllers/warehouse/warehouse.controller";
import {
  authenticate,
  requirePermission,
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
      requirePermission("warehouses.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.warehouseController.getAll.bind(this.warehouseController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("warehouses.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.warehouseController.getByUuid.bind(this.warehouseController),
    );
    this.router.get(
      "/:uuid/stock",
      authenticate,
      requirePermission("warehouses.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.warehouseController.getWarehouseStock.bind(this.warehouseController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("warehouses.edit"),
      apiRateLimiter,
      this.warehouseController.create.bind(this.warehouseController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("warehouses.edit"),
      validateUUID(),
      apiRateLimiter,
      this.warehouseController.update.bind(this.warehouseController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("warehouses.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.warehouseController.delete.bind(this.warehouseController),
    );
  }
}
