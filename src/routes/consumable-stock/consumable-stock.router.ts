import { Router } from "express";
import { ConsumableStockController } from "../../controllers/consumable-stock/consumable-stock.controller";
import { authenticate } from "../../middlewares";

export class ConsumableStockRouter {
  private _router: Router;
  private _consumableStockController = new ConsumableStockController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      authenticate,
      this._consumableStockController.getAll.bind(this._consumableStockController)
    );
    this._router.get(
      "/:uuid",
      authenticate,
      this._consumableStockController.getByUuid.bind(this._consumableStockController)
    );
    this._router.post(
      "/",
      authenticate,
      this._consumableStockController.create.bind(this._consumableStockController)
    );
    this._router.put(
      "/:uuid",
      authenticate,
      this._consumableStockController.update.bind(this._consumableStockController)
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      this._consumableStockController.delete.bind(this._consumableStockController)
    );
  }

  public get router(): Router {
    return this._router;
  }
}
