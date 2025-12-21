import { Router } from "express";
import { PaperSheetController } from "../../controllers/paper-sheet/paper-sheet.controller";

export class PaperSheetRouter {
  private _router: Router;
  private _paperSheetController = new PaperSheetController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get(
      "/",
      this._paperSheetController.getAll.bind(this._paperSheetController),
    );
    this._router.get(
      "/:uuid",
      this._paperSheetController.getByUuid.bind(this._paperSheetController),
    );
    this._router.post(
      "/",
      this._paperSheetController.create.bind(this._paperSheetController),
    );
    this._router.put(
      "/:uuid",
      this._paperSheetController.update.bind(this._paperSheetController),
    );
    this._router.delete(
      "/:uuid",
      this._paperSheetController.delete.bind(this._paperSheetController),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
