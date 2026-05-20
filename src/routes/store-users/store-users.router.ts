import { Router } from "express";
import { StoreUserController } from "../../controllers/store-user/store-user.controller";
import {
  authenticate,
  requireAdmin,
  requireStoreModule,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class StoreUsersRouter {
  public router: Router = Router();
  private readonly controller: StoreUserController = new StoreUserController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    const c = this.controller;

    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validatePagination,
      apiRateLimiter,
      c.getAll.bind(c),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      c.getByUuid.bind(c),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      apiRateLimiter,
      c.create.bind(c),
    );

    // Suffixed routes grouped first (project's defensive habit; literal segments
    // disambiguate from /:uuid mutators anyway).
    this.router.put(
      "/:uuid/password",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      sensitiveRateLimiter,
      c.setPassword.bind(c),
    );
    this.router.post(
      "/:uuid/resend-invite",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      sensitiveRateLimiter,
      c.resendInvite.bind(c),
    );
    this.router.put(
      "/:uuid/status",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      c.setStatus.bind(c),
    );

    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      apiRateLimiter,
      c.update.bind(c),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      requireStoreModule,
      validateUUID(),
      sensitiveRateLimiter,
      c.delete.bind(c),
    );
  }
}
