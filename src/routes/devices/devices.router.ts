import { Router } from "express";
import { DevicesController } from "../../controllers/devices/devices.controller";
import {
  apiRateLimiter,
  authenticate,
  requirePermission,
  validateUUID,
} from "../../middlewares";

/**
 * `/api/devices` — the approver's surface (D-20: the table is `user_devices`,
 * the route is short).
 *
 * One catalogue code for all three routes, `devices.approve` (D-15): reading the
 * pending queue and acting on it are the same job, and the repo rule forbids a
 * bare `requireAdmin()` on a write. The member holding that code is still
 * device-gated themselves by `authenticate`.
 *
 * Both writes take no body and share `apiRateLimiter` (D-148): with no secret in
 * the request there is nothing to brute-force, so neither gets a stricter cap
 * than the rest of the API's permission-gated writes.
 */
export class DevicesRouter {
  public router: Router = Router();
  private readonly controller: DevicesController = new DevicesController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requirePermission("devices.approve"),
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );

    this.router.patch(
      "/:uuid/approve",
      authenticate,
      validateUUID(),
      requirePermission("devices.approve"),
      apiRateLimiter,
      this.controller.approve.bind(this.controller),
    );

    this.router.patch(
      "/:uuid/revoke",
      authenticate,
      validateUUID(),
      requirePermission("devices.approve"),
      apiRateLimiter,
      this.controller.revoke.bind(this.controller),
    );
  }
}
