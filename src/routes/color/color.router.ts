import { Router } from "express";
import { ColorController } from "../../controllers/color/color.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class ColorRouter {
  public router: Router = Router();
  private readonly controller: ColorController = new ColorController();

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
