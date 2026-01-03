import { Router } from "express";
import { SheetStockController } from "../../controllers/sheet-stock/sheet-stock.controller";

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
      this._sheetStockController.getAll.bind(this._sheetStockController),
    );
    this._router.get(
      "/:uuid",
      this._sheetStockController.getByUuid.bind(this._sheetStockController),
    );
    this._router.post(
      "/",
      this._sheetStockController.create.bind(this._sheetStockController),
    );
    this._router.put(
      "/:uuid",
      this._sheetStockController.update.bind(this._sheetStockController),
    );
    this._router.delete(
      "/:uuid",
      this._sheetStockController.delete.bind(this._sheetStockController),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
