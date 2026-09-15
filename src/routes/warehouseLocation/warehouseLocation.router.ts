import { Router } from "express";
import { WarehouseLocationController } from "../../controllers/warehouseLocation/warehouseLocation.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class WarehouseLocationRouter {
  private _router: Router;
  private _warehouseLocationController = new WarehouseLocationController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      authenticate,
      requirePermission("warehouses.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this._warehouseLocationController.getAll.bind(
        this._warehouseLocationController,
      ),
    );
    this._router.get(
      "/:uuid",
      authenticate,
      requirePermission("warehouses.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this._warehouseLocationController.getByUuid.bind(
        this._warehouseLocationController,
      ),
    );
    this._router.post(
      "/",
      authenticate,
      requirePermission("warehouses.edit"),
      apiRateLimiter,
      this._warehouseLocationController.create.bind(
        this._warehouseLocationController,
      ),
    );
    this._router.put(
      "/:uuid",
      authenticate,
      requirePermission("warehouses.edit"),
      validateUUID(),
      apiRateLimiter,
      this._warehouseLocationController.update.bind(
        this._warehouseLocationController,
      ),
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      requirePermission("warehouses.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this._warehouseLocationController.delete.bind(
        this._warehouseLocationController,
      ),
    );

    this._router.get(
      "/warehouse/:warehouseUuid",
      authenticate,
      requirePermission("warehouses.edit", { allowReadOnly: true }),
      validateUUID("warehouseUuid"),
      apiRateLimiter,
      this._warehouseLocationController.getByWarehouse.bind(
        this._warehouseLocationController,
      ),
    );
    this._router.put(
      "/warehouse/:warehouseUuid/batch",
      authenticate,
      requirePermission("warehouses.edit"),
      validateUUID("warehouseUuid"),
      apiRateLimiter,
      this._warehouseLocationController.batchUpdate.bind(
        this._warehouseLocationController,
      ),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
