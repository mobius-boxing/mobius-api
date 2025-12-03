import { Router } from "express";
import { UsersController } from "../../controllers/users/users.controller";
import {
  authenticate,
  requireAdmin,
  requireSuperAdmin,
  requireSameCompany,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class UsersRouter {
  public router: Router = Router();
  private readonly usersController: UsersController = new UsersController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // Invite user route
    this.router.post(
      "/invite",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.usersController.invite.bind(this.usersController),
    );

    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.usersController.getAll.bind(this.usersController),
    );
    this.router.get(
      "/email/:email",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.usersController.getByEmail.bind(this.usersController),
    );
    this.router.get(
      "/:uuid/with-company",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.usersController.getWithCompany.bind(this.usersController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.usersController.getByUuid.bind(this.usersController),
    );
    this.router.post(
      "/",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.usersController.create.bind(this.usersController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      validateUUID(),
      requireSameCompany,
      apiRateLimiter,
      this.usersController.update.bind(this.usersController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.usersController.delete.bind(this.usersController),
    );
  }
}
