import { Router } from "express";
import { PaperSheetController } from "../../controllers/paper-sheet/paper-sheet.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

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
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this._paperSheetController.getAll.bind(this._paperSheetController),
    );
    this._router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this._paperSheetController.getByUuid.bind(this._paperSheetController),
    );
    this._router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this._paperSheetController.create.bind(this._paperSheetController),
    );
    this._router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this._paperSheetController.update.bind(this._paperSheetController),
    );
    this._router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this._paperSheetController.delete.bind(this._paperSheetController),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
