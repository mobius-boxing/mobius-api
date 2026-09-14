import { Router } from "express";
import { DbServersController } from "../../controllers/db-servers/db-servers.controller";
import {
  authenticate,
  requireSuperAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";

/**
 * `GET/POST /api/db-servers`, `PATCH /api/db-servers/:uuid` (model, T10;
 * D-46: superAdmin only, exactly as every `companies.router.ts` route). No
 * `PUT`/`DELETE` in this feature (model).
 */
export class DbServersRouter {
  public router: Router = Router();
  private readonly controller: DbServersController = new DbServersController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireSuperAdmin(),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.patch(
      "/:uuid",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.controller.updateStatus.bind(this.controller),
    );
  }
}
