import { Router } from "express";
import { AppConfigController } from "../../controllers/app-config/app-config.controller";
import {
  authenticate,
  requireAdmin,
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
    // writes are admin-only, mirroring Procusto's Configuración screen access.
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
      requireAdmin(),
      apiRateLimiter,
      this.controller.set.bind(this.controller),
    );
    this.router.delete(
      "/:key",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.controller.reset.bind(this.controller),
    );
  }
}
