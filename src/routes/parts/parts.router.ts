import { Router } from "express";
import { PartController } from "../../controllers/part/part.controller";
import {
  authenticate,
  requireAdmin,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

/**
 * Parts routes. CRUD writes gated by parts.edit; each approval machine by its
 * parts.approve.* code (module-02 enrichment, seeded in the catalogue).
 * The machine-specific gate is applied inside the handler chain via a
 * per-request dispatch because the code depends on the :machine param.
 */
export class PartsRouter {
  public router: Router = Router();
  private readonly controller: PartController = new PartController();

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
    this.router.post(
      "/bulk-approve",
      authenticate,
      requirePermission("parts.approve.bulk"),
      apiRateLimiter,
      this.controller.bulk("approve"),
    );
    this.router.post(
      "/bulk-unapprove",
      authenticate,
      requirePermission("parts.approve.bulk"),
      apiRateLimiter,
      this.controller.bulk("unapprove"),
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
      requirePermission("parts.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("parts.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.patch(
      "/:uuid/cascade",
      authenticate,
      requirePermission("parts.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.cascade.bind(this.controller),
    );
    // Machine-specific approval gate: dispatch to the right permission code.
    this.router.patch(
      "/:uuid/approval/:machine",
      authenticate,
      (req, res, next) => {
        const machine = String(req.params.machine);
        const code = ["dimensions", "technical", "sketch", "part"].includes(machine)
          ? `parts.approve.${machine}`
          : "parts.approve.part";
        requirePermission(code)(req, res, next);
      },
      validateUUID(),
      apiRateLimiter,
      this.controller.setApproval.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("parts.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
