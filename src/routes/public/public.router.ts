import { Router } from "express";
import { WhitelabelController } from "../../controllers/public/whitelabel.controller";
import { publicRateLimiter } from "../../middlewares";

/**
 * `/api/public/*` — endpoints served WITHOUT a token, on purpose.
 *
 * Whitelabeled module SPAs need their tenant's branding before a login form can
 * even be drawn, so there is no credential to authorize with. Nothing here may
 * therefore expose anything but branding, and only for a module that is enabled
 * for that client (see WhitelabelController).
 *
 * `publicRateLimiter` on every route: unauthenticated endpoints are keyed by IP
 * and are the cheapest thing on the API to hammer.
 */
export class PublicRouter {
  public router: Router = Router();
  private readonly whitelabelController: WhitelabelController =
    new WhitelabelController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // :module is the module's internal slug (e.g. `countdown`) — NOT the public
    // domain label (`vencimientos`). The SPA maps hostname → module slug.
    this.router.get(
      "/whitelabel/:module/:client",
      publicRateLimiter,
      this.whitelabelController.getBranding.bind(this.whitelabelController),
    );
    this.router.get(
      "/whitelabel/:module/:client/logo",
      publicRateLimiter,
      this.whitelabelController.getLogo.bind(this.whitelabelController),
    );
  }
}
