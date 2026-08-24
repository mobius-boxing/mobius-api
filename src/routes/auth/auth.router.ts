import { Router } from "express";
import { AuthController } from "../../controllers/auth/auth.controller";
import {
  authenticate,
  authRateLimiter,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

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
    // /me is an alias for /profile that the frontend expects to exist.
    this.router.get(
      "/me",
      authenticate,
      apiRateLimiter,
      this.authController.getProfile.bind(this.authController),
    );
    // Stateless JWT logout — exists so the client's POST doesn't 404; becomes
    // meaningful if/when server-side token revocation lands.
    this.router.post("/logout", authenticate, apiRateLimiter, (_req, res) => {
      res.status(200).json({ success: true, message: "Logged out" });
    });
    this.router.post(
      "/change-password",
      authenticate,
      sensitiveRateLimiter,
      this.authController.changePassword.bind(this.authController),
    );
  }
}
