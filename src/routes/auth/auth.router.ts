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
    // Public routes with rate limiting
    this.router.post(
      "/register",
      authRateLimiter,
      this.authController.register.bind(this.authController)
    );
    this.router.post(
      "/login",
      authRateLimiter,
      this.authController.login.bind(this.authController)
    );
    this.router.post(
      "/request-password-reset",
      authRateLimiter,
      this.authController.requestPasswordReset.bind(this.authController)
    );
    this.router.post(
      "/reset-password",
      authRateLimiter,
      this.authController.resetPassword.bind(this.authController)
    );

    // Protected routes (require authentication)
    this.router.get(
      "/profile",
      authenticate,
      apiRateLimiter,
      this.authController.getProfile.bind(this.authController)
    );
    this.router.post(
      "/change-password",
      authenticate,
      sensitiveRateLimiter,
      this.authController.changePassword.bind(this.authController)
    );
  }
}
