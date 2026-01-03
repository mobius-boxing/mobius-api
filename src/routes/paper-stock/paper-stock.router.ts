import { Router } from "express";
import { PaperStockController } from "../../controllers/paper-stock/paper-stock.controller";

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
      this._paperStockController.getAll.bind(this._paperStockController),
    );
    this._router.get(
      "/:uuid",
      this._paperStockController.getByUuid.bind(this._paperStockController),
    );
    this._router.post(
      "/",
      this._paperStockController.create.bind(this._paperStockController),
    );
    this._router.put(
      "/:uuid",
      this._paperStockController.update.bind(this._paperStockController),
    );
    this._router.delete(
      "/:uuid",
      this._paperStockController.delete.bind(this._paperStockController),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
