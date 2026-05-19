import { Router } from "express";
import { ConsumableSupplyController } from "../../controllers/consumable-supply/consumable-supply.controller";
import { authenticate } from "../../middlewares";

export class ConsumableSupplyRouter {
  private _router: Router;
  private _consumableSupplyController = new ConsumableSupplyController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      authenticate,
      this._consumableSupplyController.getAll.bind(this._consumableSupplyController)
    );
    this._router.get(
      "/:uuid",
      authenticate,
      this._consumableSupplyController.getByUuid.bind(this._consumableSupplyController)
    );
    this._router.post(
      "/",
      authenticate,
      this._consumableSupplyController.create.bind(this._consumableSupplyController)
    );
    this._router.put(
      "/:uuid",
      authenticate,
      this._consumableSupplyController.update.bind(this._consumableSupplyController)
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      this._consumableSupplyController.delete.bind(this._consumableSupplyController)
    );
  }

  public get router(): Router {
    return this._router;
  }
}
