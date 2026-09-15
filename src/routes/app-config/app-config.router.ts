import { Router } from "express";
import { AppConfigController } from "../../controllers/app-config/app-config.controller";
import {
  authenticate,
  requirePermission,
  apiRateLimiter,
} from "../../middlewares";

export class AppConfigRouter {
  public router: Router = Router();
  private readonly controller: AppConfigController = new AppConfigController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // Reads are open to any authenticated user (config drives app behavior client-side);
    // writes require settings.edit.
    this.router.get(
      "/",
      authenticate,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.get(
      "/:key",
      authenticate,
      apiRateLimiter,
      this.controller.getByKey.bind(this.controller),
    );
    this.router.put(
      "/:key",
      authenticate,
      requirePermission("settings.edit"),
      apiRateLimiter,
      this.controller.set.bind(this.controller),
    );
    this.router.delete(
      "/:key",
      authenticate,
      requirePermission("settings.edit"),
      apiRateLimiter,
      this.controller.reset.bind(this.controller),
    );
  }
}
