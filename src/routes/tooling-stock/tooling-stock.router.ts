import { Router } from "express";
import { ToolingStockController } from "../../controllers/tooling-stock/tooling-stock.controller";
import { authenticate } from "../../middlewares";

export class ToolingStockRouter {
  private _router: Router;
  private _toolingStockController = new ToolingStockController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      authenticate,
      this._toolingStockController.getAll.bind(this._toolingStockController)
    );
    this._router.get(
      "/:uuid",
      authenticate,
      this._toolingStockController.getByUuid.bind(this._toolingStockController)
    );
    this._router.post(
      "/",
      authenticate,
      this._toolingStockController.create.bind(this._toolingStockController)
    );
    this._router.put(
      "/:uuid",
      authenticate,
      this._toolingStockController.update.bind(this._toolingStockController)
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      this._toolingStockController.delete.bind(this._toolingStockController)
    );
  }

  public get router(): Router {
    return this._router;
  }
}
