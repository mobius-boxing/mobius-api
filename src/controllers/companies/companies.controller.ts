import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ModuleDAO } from "../../dao/module/module.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { ICompany } from "../../interfaces/company/company.interfaces";
import { v4 as uuidv4 } from "uuid";
import {
  CompanyBrandingInputDTO,
  CompanyCreateInputDTO,
  CompanyUpdateInputDTO,
} from "../../dto/input/company";
import { setAuditAction } from "../../database/audit-context";
import { db, withTenantTarget } from "../../database/registry";
import { purgeCompany } from "../../services/company-purge.service";
import { TenantDatabaseDAO } from "../../dao/tenant-database/tenant-database.dao";
import {
  beginProvisioning,
  decommissionTenantDatabase,
  runProvisioningSteps,
} from "../../services/tenant-provisioning.service";

export class CompaniesController implements IBaseController {
  private _companyDAO: CompanyDAO = new CompanyDAO();
  private _tenantDatabaseDAO: TenantDatabaseDAO = new TenantDatabaseDAO();
  private _moduleDAO: ModuleDAO = new ModuleDAO();
  private _companyModuleDAO: CompanyModuleDAO = new CompanyModuleDAO();
  private _userDAO: UserDAO = new UserDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await this._companyDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._companyDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Company not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // build() throws on an invalid or reserved slug; that is always a 400,
      // never the 500 an unguarded throw would produce here.
      let inputDTO: CompanyCreateInputDTO;
      try {
        inputDTO = new CompanyCreateInputDTO(data).build();
      } catch (dtoErr: any) {
        req.statusCode = 400;
        return next(new Error(dtoErr?.message ?? "Datos inválidos"));
      }
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const dataToCreate: ICompany = {
        uuid: uuidv4(),
        name: inputDTO.name,
        slug: inputDTO.slug,
        description: inputDTO.description,
        isActive: true,
      };

      const result = await this._companyDAO.create(dataToCreate);

      // Auto-link the `core` module to the freshly-created company so users
      // can log in with at least one module enabled. Fail-soft: the migration
      // backfill is the safety net for existing rows; this is the forward-fix.
      try {
        const coreModule = await this._moduleDAO.getBySlug("core");
        const actorUuid = (req as any).user?.userId as string | undefined;
        const actorId = actorUuid
          ? await this._userDAO.getIdByUuid(actorUuid)
          : null;
        if (coreModule && coreModule.id && result.id) {
          await this._companyModuleDAO.enable(
            result.id,
            coreModule.id,
            actorId,
          );
        }
      } catch (linkErr) {
        console.error(
          "Failed to auto-link core module on company create:",
          linkErr,
        );
      }

      // Provision the RBAC catalogue (permissions clone + protected Admin role +
      // Procusto profile templates — module 02, Model B). Fail-soft: the seed
      // migration backfills existing rows; re-running the seed is idempotent.
      try {
        if (result.id) {
          const { RbacService } = await import("../../services/rbac.service");
          await RbacService.seedCompanyRbac(db("core"), result.id);
        }
      } catch (rbacErr) {
        console.error(
          "Failed to seed RBAC catalogue on company create:",
          rbacErr,
        );
      }

      // Tenant database provisioning (model D-19; brief AC-62): the default
      // placement, started in-process and fire-and-forget — company creation
      // never fails because of it (a thrown/refused start just leaves
      // `tenantDatabase: null`, matching `GET .../tenant-database`'s own
      // `TENANT_DB_NOT_REGISTERED` state for "no row at all").
      let tenantDatabaseSummary: { status: string; placement: string } | null =
        null;
      try {
        if (result.id) {
          const prepared = await beginProvisioning(result.id, {
            deferServerPreconditions: true,
          });
          if (prepared.ok) {
            tenantDatabaseSummary = {
              status: prepared.row.status,
              placement: prepared.server.kind,
            };
            if (prepared.needsRun) {
              void runProvisioningSteps(
                prepared.row,
                prepared.server,
                prepared.companyUuid,
              ).catch((provisionErr) => {
                console.error(
                  `Tenant provisioning failed for company #${result.id}:`,
                  provisionErr,
                );
              });
            }
          } else {
            console.error(
              `Failed to start tenant provisioning for company #${result.id}:`,
              prepared.reason,
            );
          }
        }
      } catch (provisionErr) {
        console.error(
          "Failed to start tenant provisioning on company create:",
          provisionErr,
        );
      }

      res.status(201).json({
        success: true,
        data: { ...result, tenantDatabase: tenantDatabaseSummary },
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const existing = await this._companyDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Company not found",
        });
        return;
      }

      // build() throws on an invalid or reserved slug — a 400, not a 500.
      let inputDTO: CompanyUpdateInputDTO;
      try {
        inputDTO = new CompanyUpdateInputDTO(data).build();
      } catch (dtoErr: any) {
        req.statusCode = 400;
        return next(new Error(dtoErr?.message ?? "Datos inválidos"));
      }
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._companyDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * PUT /api/companies/:uuid/branding — superAdmin only.
   *
   * The company's whitelabel identity, shared by EVERY module it has (D-2).
   * Replaced WHOLESALE: the body always carries all five fields and an omitted
   * one is stored as `null`, i.e. cleared. There is no partial update — a merge
   * would make "clear this field" unexpressible.
   *
   * L-005: the uuid→id hop goes through `getIdByUuid`, never through a mapper
   * that strips numeric ids.
   */
  public async updateBranding(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json({ success: false, message: "Company not found" });
        return;
      }

      // build() throws on a bad colour, an over-long name/message or a
      // logoFileUuid that is not a uuid — always a 400, never a 500.
      let inputDTO: CompanyBrandingInputDTO;
      try {
        inputDTO = new CompanyBrandingInputDTO(req.body).build();
      } catch (dtoErr: any) {
        req.statusCode = 400;
        return next(new Error(dtoErr?.message ?? "Datos inválidos"));
      }

      // A domain verb: the trigger sees an UPDATE of `companies` like any
      // other. The row is attributed to the company being edited (ruling R-A).
      await setAuditAction("company.branding");
      const result = await this._companyDAO.updateBranding(
        companyId,
        inputDTO.toBranding(),
      );
      if (!result) {
        res.status(404).json({ success: false, message: "Company not found" });
        return;
      }

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const existing = await this._companyDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Company not found",
        });
        return;
      }
      const companyId = existing.id;

      // NOT `CompanyDAO.delete`: the ledger is append-only in the database, so
      // removing a company is only possible through the purge path, which turns
      // maintenance mode on for its own transaction (see company-purge.service).
      //
      // A live tenant_databases row (model D-20, brief AC-63) goes through
      // `decommissionTenantDatabase` first — park/purge, THEN the row+company
      // delete, all inside its own transaction. A company with no live row
      // (never registered, or only a `provisioning`/`failed` build attempt)
      // keeps the pre-T10 plain purge, unchanged.
      const liveTenantRow =
        await this._tenantDatabaseDAO.getLiveByCompanyId(companyId);

      let result: { companyDeleted: boolean };
      if (liveTenantRow) {
        try {
          const decommission = await decommissionTenantDatabase(companyId);
          if (!decommission.ok) {
            res.status(500).json({
              success: false,
              code: "TENANT_DECOMMISSION_FAILED",
              message: "Failed to decommission the company's tenant database.",
            });
            return;
          }
          result = decommission;
        } catch (decommissionErr) {
          console.error(
            `Tenant decommission failed for company #${companyId}:`,
            decommissionErr,
          );
          res.status(500).json({
            success: false,
            code: "TENANT_DECOMMISSION_FAILED",
            message: "Failed to decommission the company's tenant database.",
          });
          return;
        }
      } else {
        // T8/AC-49 (found while verifying T10): `purgeCompany`'s target list
        // resolves `physicalKeyOf("tenant")`, which now throws outside any
        // tenant scope — and `/companies` is a `central`-plane route (model),
        // so it never acquires one. A company with no live tenant row has
        // nothing on a separate tenant plane to purge anyway (pre-T9
        // semantics: "tenant" was always "core" here), so asserting that
        // known fact for the duration of this one call is correct, not a
        // workaround — mirrors T8's own `runAsCoreTenant` precedent.
        result = await withTenantTarget(
          { physicalKey: "core", instance: db("core") },
          () => purgeCompany(companyId),
        );
      }

      if (result.companyDeleted) {
        res.status(200).json({
          success: true,
          message: "Company deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete company",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * SuperAdmin only.
   */
  public async getStats(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const knex = db("core");

      const [totalResult, activeResult] = await Promise.all([
        knex("companies").count("* as count").first(),
        knex("companies").where("isActive", true).count("* as count").first(),
      ]);

      const companiesWithUsersResult = await knex("companies")
        .whereExists(function (this: any) {
          this.select(knex.raw(1))
            .from("users")
            .whereRaw('"users"."companyId" = "companies"."id"');
        })
        .count("* as count")
        .first();

      const totalCompanies = parseInt(totalResult?.count as string) || 0;
      const totalUsersResult = await knex("users").count("* as count").first();
      const totalUsers = parseInt(totalUsersResult?.count as string) || 0;
      const averageUsersPerCompany =
        totalCompanies > 0
          ? Math.round((totalUsers / totalCompanies) * 100) / 100
          : 0;

      const stats = {
        totalCompanies,
        activeCompanies: parseInt(activeResult?.count as string) || 0,
        companiesWithUsers:
          parseInt(companiesWithUsersResult?.count as string) || 0,
        averageUsersPerCompany,
      };

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async getWithUserCount(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._companyDAO.getCompanyWithUserCount(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Company not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }
}
