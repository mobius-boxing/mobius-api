import { Router } from "express";
import { ConsumableSupplyController } from "../../controllers/consumable-supply/consumable-supply.controller";
import { authenticate, requirePermission } from "../../middlewares";

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
      requirePermission("consumable-supplies.edit", { allowReadOnly: true }),
      this._consumableSupplyController.getAll.bind(
        this._consumableSupplyController,
      ),
    );
    this._router.get(
      "/:uuid",
      authenticate,
      requirePermission("consumable-supplies.edit", { allowReadOnly: true }),
      this._consumableSupplyController.getByUuid.bind(
        this._consumableSupplyController,
      ),
    );
    this._router.post(
      "/",
      authenticate,
      requirePermission("consumable-supplies.edit"),
      this._consumableSupplyController.create.bind(
        this._consumableSupplyController,
      ),
    );
    this._router.put(
      "/:uuid",
      authenticate,
      requirePermission("consumable-supplies.edit"),
      this._consumableSupplyController.update.bind(
        this._consumableSupplyController,
      ),
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      requirePermission("consumable-supplies.edit"),
      this._consumableSupplyController.delete.bind(
        this._consumableSupplyController,
      ),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
