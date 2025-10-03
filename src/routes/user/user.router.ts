import { Router } from "express";
import { UserController } from "../../controllers/user/user.controller";
import {
  authenticate,
  requireAdmin,
  requireSameCompany,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class UserRouter {
  public router: Router = Router();
  private readonly userController: UserController = new UserController();

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
      this.userController.getAll.bind(this.userController)
    );
    this.router.get(
      "/email/:email",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.userController.getByEmail.bind(this.userController)
    );
    this.router.get(
      "/:uuid/with-company",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.userController.getWithCompany.bind(this.userController)
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.userController.getByUuid.bind(this.userController)
    );
    this.router.post(
      "/",
      authenticate,
      requireAdmin(),
      apiRateLimiter,
      this.userController.create.bind(this.userController)
    );
    this.router.put(
      "/:uuid",
      authenticate,
      validateUUID(),
      requireSameCompany,
      apiRateLimiter,
      this.userController.update.bind(this.userController)
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.userController.delete.bind(this.userController)
    );
  }
}
