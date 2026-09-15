import { Router } from "express";
import { ConsumableTypeController } from "../../controllers/consumable-type/consumable-type.controller";
import { authenticate, requirePermission } from "../../middlewares";

export class ConsumableTypeRouter {
  private _router: Router;
  private _consumableTypeController = new ConsumableTypeController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      authenticate,
      requirePermission("consumable-types.edit", { allowReadOnly: true }),
      this._consumableTypeController.getAll.bind(
        this._consumableTypeController,
      ),
    );
    this._router.get(
      "/:uuid",
      authenticate,
      requirePermission("consumable-types.edit", { allowReadOnly: true }),
      this._consumableTypeController.getByUuid.bind(
        this._consumableTypeController,
      ),
    );
    this._router.post(
      "/",
      authenticate,
      requirePermission("consumable-types.edit"),
      this._consumableTypeController.create.bind(
        this._consumableTypeController,
      ),
    );
    this._router.put(
      "/:uuid",
      authenticate,
      requirePermission("consumable-types.edit"),
      this._consumableTypeController.update.bind(
        this._consumableTypeController,
      ),
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      requirePermission("consumable-types.edit"),
      this._consumableTypeController.delete.bind(
        this._consumableTypeController,
      ),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
