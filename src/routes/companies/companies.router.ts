import { Router } from "express";
import { CompaniesController } from "../../controllers/companies/companies.controller";
import { CompanyModulesController } from "../../controllers/companies/company-modules.controller";
import { TenantDatabaseController } from "../../controllers/companies/tenant-database.controller";
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
  private readonly tenantDatabaseController: TenantDatabaseController =
    new TenantDatabaseController();

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
    // Whitelabel branding write (modules.md §3). SuperAdmin only, like every
    // other company↔module route.
    this.router.put(
      "/:uuid/modules/:slug/config",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyModulesController.updateConfig.bind(
        this.companyModulesController,
      ),
    );
    // Company-level whitelabel branding (D-2): one identity per client, shared
    // by every module it has. SuperAdmin only, like every other company route.
    this.router.put(
      "/:uuid/branding",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companiesController.updateBranding.bind(this.companiesController),
    );
    this.router.delete(
      "/:uuid/modules/:slug",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.companyModulesController.disable.bind(this.companyModulesController),
    );
    // Tenant database status/provisioning/suspension (db-per-company T10,
    // model D-24/D-46): superAdmin only, like every other company route.
    this.router.get(
      "/:uuid/tenant-database",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.tenantDatabaseController.getByCompany.bind(
        this.tenantDatabaseController,
      ),
    );
    this.router.post(
      "/:uuid/tenant-database/provision",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.tenantDatabaseController.provision.bind(
        this.tenantDatabaseController,
      ),
    );
    this.router.post(
      "/:uuid/tenant-database/suspend",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.tenantDatabaseController.suspend.bind(this.tenantDatabaseController),
    );
    this.router.post(
      "/:uuid/tenant-database/resume",
      authenticate,
      requireSuperAdmin(),
      validateUUID(),
      apiRateLimiter,
      this.tenantDatabaseController.resume.bind(this.tenantDatabaseController),
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
