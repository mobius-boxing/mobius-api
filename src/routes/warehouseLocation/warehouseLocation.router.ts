import { Router } from "express";
import { WarehouseLocationController } from "../../controllers/warehouseLocation/warehouseLocation.controller";

export class WarehouseLocationRouter {
  private _router: Router;
  private _warehouseLocationController = new WarehouseLocationController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    // Generic location endpoints
    this._router.get("/", this._warehouseLocationController.getAll.bind(this._warehouseLocationController));
    this._router.get("/:uuid", this._warehouseLocationController.getByUuid.bind(this._warehouseLocationController));
    this._router.post("/", this._warehouseLocationController.create.bind(this._warehouseLocationController));
    this._router.put("/:uuid", this._warehouseLocationController.update.bind(this._warehouseLocationController));
    this._router.delete("/:uuid", this._warehouseLocationController.delete.bind(this._warehouseLocationController));

    // Warehouse-specific location endpoints
    this._router.get("/warehouse/:warehouseUuid", this._warehouseLocationController.getByWarehouse.bind(this._warehouseLocationController));
    this._router.put("/warehouse/:warehouseUuid/batch", this._warehouseLocationController.batchUpdate.bind(this._warehouseLocationController));
  }

  public get router(): Router {
    return this._router;
  }
}
