import { Router } from "express";
import { InvitationsController } from "../../controllers/invitations/invitations.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  publicRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class InvitationsRouter {
  public router: Router = Router();
  private readonly invitationsController: InvitationsController =
    new InvitationsController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // Public routes (no authentication required)
    this.router.get(
      "/token/:token",
      publicRateLimiter,
      this.invitationsController.getByToken.bind(this.invitationsController),
    );
    this.router.post(
      "/accept/:token",
      publicRateLimiter,
      this.invitationsController.acceptInvitation.bind(
        this.invitationsController,
      ),
    );

    // Protected routes (authentication required)
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.invitationsController.getAll.bind(this.invitationsController),
    );
    this.router.get(
      "/company/:companyId/active",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.invitationsController.getActiveInvitations.bind(
        this.invitationsController,
      ),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.invitationsController.getByUuid.bind(this.invitationsController),
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.invitationsController.create.bind(this.invitationsController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.invitationsController.update.bind(this.invitationsController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.invitationsController.delete.bind(this.invitationsController),
    );
  }
}
