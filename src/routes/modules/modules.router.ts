import { Router } from "express";
import { ModulesController } from "../../controllers/modules/modules.controller";
import {
  authenticate,
  requireSuperAdmin,
  apiRateLimiter,
} from "../../middlewares";

export class ModulesRouter {
  public router: Router = Router();
  private readonly modulesController: ModulesController =
    new ModulesController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.modulesController.getAll.bind(this.modulesController),
    );
  }
}
