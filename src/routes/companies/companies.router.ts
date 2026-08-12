import { Router } from "express";
import { CompaniesController } from "../../controllers/companies/companies.controller";
import { CompanyModulesController } from "../../controllers/companies/company-modules.controller";
import {
  authenticate,
  requireSuperAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
} from "../../middlewares";

export class CompaniesRouter {
  public router: Router = Router();
  private readonly companiesController: CompaniesController =
    new CompaniesController();
  private readonly companyModulesController: CompanyModulesController =
    new CompanyModulesController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    // Stats route (must come before /:uuid to avoid UUID validation)
    this.router.get(
      "/stats",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.companiesController.getStats.bind(this.companiesController),
    );

    this.router.get(
      "/",
      authenticate,
      requireSuperAdmin(),
      validatePagination,
      apiRateLimiter,
      this.companiesController.getAll.bind(this.companiesController),
    );
    this.router.get(
      "/:uuid/with-user-count",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companiesController.getWithUserCount.bind(this.companiesController),
    );
    this.router.get(
      "/:uuid/modules",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyModulesController.getByCompany.bind(
        this.companyModulesController,
      ),
    );
    this.router.post(
      "/:uuid/modules/:slug",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyModulesController.enable.bind(this.companyModulesController),
    );
    this.router.delete(
      "/:uuid/modules/:slug",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyModulesController.disable.bind(this.companyModulesController),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.companiesController.getByUuid.bind(this.companiesController),
    );
    this.router.post(
      "/",
      authenticate,
      requireSuperAdmin(),
      apiRateLimiter,
      this.companiesController.create.bind(this.companiesController),
    );
    this.router.put(
      "/:uuid",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companiesController.update.bind(this.companiesController),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companiesController.delete.bind(this.companiesController),
    );
  }
}
