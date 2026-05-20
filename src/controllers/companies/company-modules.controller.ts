import { Request, Response, NextFunction } from "express";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ModuleDAO } from "../../dao/module/module.dao";
import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { ICompanyModuleWithModule } from "../../interfaces/company-module/company-module.interfaces";

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
   */
  private toResponse(row: ICompanyModuleWithModule) {
    return {
      module: {
        uuid: row.moduleUuid,
        slug: row.slug,
        name: row.name,
        description: row.description,
        isCore: row.isCore,
      },
      enabled: row.enabled,
      enabledAt: row.enabledAt,
      disabledAt: row.disabledAt,
      subscriptionStatus: row.subscriptionStatus,
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

      if (module.isCore) {
        res.status(400).json({
          success: false,
          message: "Cannot disable core module",
        });
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
