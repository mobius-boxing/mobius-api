import { Router } from "express";
import { AuthController } from "../../controllers/auth/auth.controller";
import {
  authenticate,
  authRateLimiter,
  refreshRateLimiter,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";
import { singleFileUpload } from "../../middlewares/upload.middleware";
import { AVATAR_MAX_BYTES } from "../../services/user-avatar.service";

export class AuthRouter {
  public router: Router = Router();
  private readonly authController: AuthController = new AuthController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.post(
      "/register",
      authRateLimiter,
      this.authController.register.bind(this.authController),
    );
    this.router.post(
      "/login",
      authRateLimiter,
      this.authController.login.bind(this.authController),
    );
    this.router.post(
      "/request-password-reset",
      authRateLimiter,
      this.authController.requestPasswordReset.bind(this.authController),
    );
    this.router.post(
      "/reset-password",
      authRateLimiter,
      this.authController.resetPassword.bind(this.authController),
    );
    this.router.post(
      "/accept-invitation/:token",
      authRateLimiter,
      this.authController.acceptInvitation.bind(this.authController),
    );

    this.router.get(
      "/profile",
      authenticate,
      apiRateLimiter,
      this.authController.getProfile.bind(this.authController),
    );
    this.router.put(
      "/profile",
      authenticate,
      apiRateLimiter,
      this.authController.updateProfile.bind(this.authController),
    );
    // /me is an alias for /profile that the frontend expects to exist.
    this.router.get(
      "/me",
      authenticate,
      apiRateLimiter,
      this.authController.getProfile.bind(this.authController),
    );
    // The waiting screen's poll. Exempt from the device gate, so a pending
    // member can watch their own device's status while every other route 403s.
    this.router.get(
      "/device",
      authenticate,
      apiRateLimiter,
      this.authController.getDevice.bind(this.authController),
    );
    // Gate amendment 3 (D-230): lets an already-signed-in member whose session
    // outlived a deploy register this browser without re-authenticating.
    // Exempt from the device gate; idempotent (I-19).
    this.router.post(
      "/device",
      authenticate,
      apiRateLimiter,
      this.authController.registerDevice.bind(this.authController),
    );
    this.router.put(
      "/avatar",
      authenticate,
      apiRateLimiter,
      singleFileUpload(AVATAR_MAX_BYTES),
      this.authController.uploadAvatar.bind(this.authController),
    );
    this.router.delete(
      "/avatar",
      authenticate,
      apiRateLimiter,
      this.authController.removeAvatar.bind(this.authController),
    );
    this.router.post(
      "/refresh",
      refreshRateLimiter,
      this.authController.refresh.bind(this.authController),
    );
    // No `authenticate`: logout must work with an expired or missing access token.
    this.router.post(
      "/logout",
      apiRateLimiter,
      this.authController.logout.bind(this.authController),
    );
    this.router.post(
      "/change-password",
      authenticate,
      sensitiveRateLimiter,
      this.authController.changePassword.bind(this.authController),
    );
  }
}
