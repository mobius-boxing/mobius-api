import { Router } from "express";
import { ModelController } from "../../controllers/model/model.controller";
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
 * Models routes (module 08). Reads stay admin-gated; writes and test-formula
 * gated by the models.edit catalogue code (mirroring palletizations).
 *
 * ROUTE ORDER: /test-formula and /formula-reference MUST register before
 * /:uuid or validateUUID() rejects them with a uuid-validation 400.
 */
export class ModelsRouter {
  public router: Router = Router();
  private readonly controller: ModelController = new ModelController();

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
      "/test-formula",
      authenticate,
      requirePermission("models.edit"),
      apiRateLimiter,
      this.controller.testFormula.bind(this.controller),
    );
    this.router.get(
      "/formula-reference",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.controller.formulaReference.bind(this.controller),
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
      requirePermission("models.edit"),
      apiRateLimiter,
      this.controller.create.bind(this.controller),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("models.edit"),
      validateUUID(),
      apiRateLimiter,
      this.controller.update.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("models.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
