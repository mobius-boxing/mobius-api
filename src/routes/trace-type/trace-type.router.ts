import { Router } from "express";
import { TraceTypeController } from "../../controllers/trace-type/trace-type.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveTraceTypeDeletionRateLimiter,
} from "../../middlewares";

export class TraceTypeRouter {
  public router: Router = Router();
  private readonly traceTypeController: TraceTypeController =
    new TraceTypeController();

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
      this.traceTypeController.getAll.bind(this.traceTypeController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.traceTypeController.getByUuid.bind(this.traceTypeController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.traceTypeController.create.bind(this.traceTypeController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.traceTypeController.update.bind(this.traceTypeController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveTraceTypeDeletionRateLimiter,
      this.traceTypeController.delete.bind(this.traceTypeController),
    );
  }
}
