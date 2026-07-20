import { Router } from "express";
import { PaperStockController } from "../../controllers/paper-stock/paper-stock.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class PaperStockRouter {
  private _router: Router;
  private _paperStockController = new PaperStockController();

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
      this._paperStockController.getAll.bind(this._paperStockController),
    );
    this._router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this._paperStockController.getByUuid.bind(this._paperStockController),
    );
    this._router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this._paperStockController.create.bind(this._paperStockController),
    );
    this._router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this._paperStockController.update.bind(this._paperStockController),
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this._paperStockController.delete.bind(this._paperStockController),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
