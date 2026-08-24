import { Router } from "express";
import { AuditLogController } from "../../controllers/audit-log/audit-log.controller";
import {
  authenticate,
  requireAdmin,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";

export class AuditLogsRouter {
  public router: Router = Router();
  private readonly controller: AuditLogController = new AuditLogController();

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
  }
}
