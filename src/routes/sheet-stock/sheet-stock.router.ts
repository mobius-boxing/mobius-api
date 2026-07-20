import { Router } from "express";
import { SheetStockController } from "../../controllers/sheet-stock/sheet-stock.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class SheetStockRouter {
  private _router: Router;
  private _sheetStockController = new SheetStockController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this._sheetStockController.getAll.bind(this._sheetStockController),
    );
    this._router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this._sheetStockController.getByUuid.bind(this._sheetStockController),
    );
    this._router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this._sheetStockController.create.bind(this._sheetStockController),
    );
    this._router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this._sheetStockController.update.bind(this._sheetStockController),
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this._sheetStockController.delete.bind(this._sheetStockController),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
