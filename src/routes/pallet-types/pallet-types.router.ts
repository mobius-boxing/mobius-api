import { Router } from "express";
import { PalletTypeController } from "../../controllers/pallet-type/pallet-type.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class PalletTypesRouter {
  public router: Router = Router();
  private readonly controller: PalletTypeController = new PalletTypeController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
