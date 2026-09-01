import { Request, Response, NextFunction } from "express";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ModuleDAO } from "../../dao/module/module.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { ICompanyModuleWithModule } from "../../interfaces/company-module/company-module.interfaces";
import { CompanyModuleConfigInputDTO } from "../../dto/input/company";
import { setAuditAction } from "../../database/audit-context";

export class CompanyModulesController {
  private _companyDAO: CompanyDAO = new CompanyDAO();
  private _moduleDAO: ModuleDAO = new ModuleDAO();
  private _companyModuleDAO: CompanyModuleDAO = new CompanyModuleDAO();
  private _userDAO: UserDAO = new UserDAO();

  /**
   * Reshape the DAO's flat ICompanyModuleWithModule row into the nested response
   * shape documented in api-plan.md §3 (module identity vs link state).
   *
   * SECURITY: drops the internal numeric audit IDs (moduleId, companyModuleId,
   * enabledBy, disabledBy) so they never leak to the client.
   *
   * `config` IS included: these endpoints are superAdmin-only and it holds no
   * secrets — whatever ends up under the module namespace is served publicly
   * anyway. It is NO LONGER the branding source, though: branding is a company
   * property (`companies.branding`, `PUT /api/companies/:uuid/branding`) and
   * whatever `config.<slug>.branding` still holds is legacy and unread.
   *
   * `publicDomainLabel` rides along on the module identity so the backoffice can
   * compose `{company.slug}.{publicDomainLabel}.{domain}` without a second call.
   */
  private toResponse(row: ICompanyModuleWithModule) {
    return {
      module: {
        uuid: row.moduleUuid,
        slug: row.slug,
        name: row.name,
        description: row.description,
        isCore: row.isCore,
        publicDomainLabel: row.publicDomainLabel,
      },
      enabled: row.enabled,
      enabledAt: row.enabledAt,
      disabledAt: row.disabledAt,
      subscriptionStatus: row.subscriptionStatus,
      config: row.config,
    };
  }

  public async getByCompany(
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
      const rows = await this._companyModuleDAO.getByCompany(companyId);
      res
        .status(200)
        .json({ success: true, data: rows.map((r) => this.toResponse(r)) });
    } catch (err: any) {
      next(err);
    }
  }

  public async enable(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid, slug } = req.params;

      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json({ success: false, message: "Company not found" });
        return;
      }

      const module = await this._moduleDAO.getBySlug(slug);
      if (!module || !module.id) {
        res.status(404).json({ success: false, message: "Module not found" });
        return;
      }

      const actorUuid = (req as any).user?.userId as string | undefined;
      const actorId = actorUuid
        ? await this._userDAO.getIdByUuid(actorUuid)
        : null;

      const row = await this._companyModuleDAO.enable(
        companyId,
        module.id,
        actorId,
      );

      res.status(200).json({ success: true, data: this.toResponse(row) });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * PUT /api/companies/:uuid/modules/:slug/config — superAdmin only.
   *
   * Writes the module's whitelabel branding into `company_modules.config` under
   * the module's own namespace. The DAO merges rather than replaces, so this
   * can never clobber another module's configuration.
   */
  public async updateConfig(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid, slug } = req.params;

      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json({ success: false, message: "Company not found" });
        return;
      }

      const module = await this._moduleDAO.getBySlug(slug);
      if (!module || !module.id) {
        res.status(404).json({ success: false, message: "Module not found" });
        return;
      }

      // build() throws on a bad colour, an over-long name/message or a
      // logoFileUuid that is not a uuid — always a 400.
      let inputDTO: CompanyModuleConfigInputDTO;
      try {
        inputDTO = new CompanyModuleConfigInputDTO(req.body).build();
      } catch (dtoErr: any) {
        req.statusCode = 400;
        return next(new Error(dtoErr?.message ?? "Datos inválidos"));
      }

      // A domain verb: the trigger sees an UPDATE of `company_modules`.
      await setAuditAction("company_module.config");
      const row = await this._companyModuleDAO.updateConfig(
        companyId,
        module.id,
        module.slug,
        inputDTO.toConfigSection(),
      );
      if (!row) {
        res.status(404).json({
          success: false,
          message: "Module is not enabled for this company",
        });
        return;
      }

      res.status(200).json({ success: true, data: this.toResponse(row) });
    } catch (err: any) {
      next(err);
    }
  }

  public async disable(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid, slug } = req.params;

      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json({ success: false, message: "Company not found" });
        return;
      }

      const module = await this._moduleDAO.getBySlug(slug);
      if (!module || !module.id) {
        res.status(404).json({ success: false, message: "Module not found" });
        return;
      }

      const actorUuid = (req as any).user?.userId as string | undefined;
      const actorId = actorUuid
        ? await this._userDAO.getIdByUuid(actorUuid)
        : null;

      const row = await this._companyModuleDAO.disable(
        companyId,
        module.id,
        actorId,
      );
      if (!row) {
        res.status(404).json({
          success: false,
          message: "Module is not enabled for this company",
        });
        return;
      }

      res.status(200).json({ success: true, data: this.toResponse(row) });
    } catch (err: any) {
      next(err);
    }
  }
}
