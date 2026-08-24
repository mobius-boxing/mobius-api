import { Router } from "express";
import { RoleController } from "../../controllers/role/role.controller";
import {
  authenticate,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

/**
 * Gated by the `roles.edit` permission (Procusto "Perfiles"); reads also accept
 * its `.readonly` variant. Legacy admins pass via the transition fallback,
 * superAdmin always passes.
 */
export class RolesRouter {
  public router: Router = Router();
  private readonly controller: RoleController = new RoleController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("roles.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    // Must precede /:uuid routes so "assign" is not parsed as a uuid.
    this.router.put(
      "/assign",
      authenticate,
      requirePermission("users.edit"),
      apiRateLimiter,
      this.controller.assign.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("roles.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("roles.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid/permissions",
      authenticate,
      requirePermission("roles.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.setPermissions.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("roles.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("roles.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
