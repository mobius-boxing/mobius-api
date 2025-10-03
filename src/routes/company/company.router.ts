import { Router } from "express";
import { CompanyController } from "../../controllers/company/company.controller";
import {
  authenticate,
  requireAdmin,
  requireSuperAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

export class CompanyRouter {
  public router: Router = Router();
  private readonly companyController: CompanyController =
    new CompanyController();

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
      this.companyController.getAll.bind(this.companyController)
    );
    this.router.get(
      "/:uuid/with-user-count",
      authenticate,
      requireAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyController.getWithUserCount.bind(this.companyController)
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.companyController.getByUuid.bind(this.companyController)
    );
    this.router.post(
      "/",
      authenticate,
      requireSuperAdmin(),
      sensitiveRateLimiter,
      this.companyController.create.bind(this.companyController)
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyController.update.bind(this.companyController)
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      sensitiveRateLimiter,
      this.companyController.delete.bind(this.companyController)
    );
  }
}
