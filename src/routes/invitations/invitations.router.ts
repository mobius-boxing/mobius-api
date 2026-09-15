import { Router } from "express";
import { InvitationsController } from "../../controllers/invitations/invitations.controller";
import {
  authenticate,
  requirePermission,
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

    // Stats route (must come before /:uuid to avoid UUID validation)
    this.router.get(
      "/stats",
      authenticate,
      requirePermission("users.edit", { allowReadOnly: true }),
      apiRateLimiter,
      this.invitationsController.getStats.bind(this.invitationsController),
    );

    this.router.get(
      "/",
      authenticate,
      requirePermission("users.edit", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.invitationsController.getAll.bind(this.invitationsController),
    );
    this.router.get(
      "/company/:companyId/active",
      authenticate,
      requirePermission("users.edit", { allowReadOnly: true }),
      apiRateLimiter,
      this.invitationsController.getActiveInvitations.bind(
        this.invitationsController,
      ),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("users.edit", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.invitationsController.getByUuid.bind(this.invitationsController),
    );
    this.router.post(
      "/",
      authenticate,
      requirePermission("users.edit"),
      apiRateLimiter,
      this.invitationsController.create.bind(this.invitationsController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requirePermission("users.edit"),
      validateUUID(),
      apiRateLimiter,
      this.invitationsController.update.bind(this.invitationsController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requirePermission("users.edit"),
      validateUUID(),
      sensitiveRateLimiter,
      this.invitationsController.delete.bind(this.invitationsController),
    );
  }
}
