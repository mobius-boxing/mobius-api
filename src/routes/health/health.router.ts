import { Router } from "express";
import { HealthController } from "../../controllers/health/health.controller";

export class HealthRouter {
  public router: Router = Router();
  private readonly healthController: HealthController = new HealthController();
  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      this.healthController.getHealthStatus.bind(this.healthController),
    );
  }
}
