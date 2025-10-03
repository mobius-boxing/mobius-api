import { Router } from "express";
import { InvitationController } from "../../controllers/invitation/invitation.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  publicRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class InvitationRouter {
  public router: Router = Router();
  private readonly invitationController: InvitationController =
    new InvitationController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // Public routes (no authentication required)
    this.router.get(
      "/token/:token",
      publicRateLimiter,
      this.invitationController.getByToken.bind(this.invitationController)
    );
    this.router.post(
      "/accept/:token",
      publicRateLimiter,
      this.invitationController.acceptInvitation.bind(
        this.invitationController
      )
    );

    // Protected routes (authentication required)
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.invitationController.getAll.bind(this.invitationController)
    );
    this.router.get(
      "/company/:companyId/active",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.invitationController.getActiveInvitations.bind(
        this.invitationController
      )
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.invitationController.getByUuid.bind(this.invitationController)
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.invitationController.create.bind(this.invitationController)
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.invitationController.update.bind(this.invitationController)
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.invitationController.delete.bind(this.invitationController)
    );
  }
}
