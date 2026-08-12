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
  CompanyCreateInputDTO,
  CompanyUpdateInputDTO,
} from "../../dto/input/company";

export class CompaniesController implements IBaseController {
  private _companyDAO: CompanyDAO = new CompanyDAO();
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

      const inputDTO = new CompanyCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const dataToCreate: ICompany = {
        uuid: uuidv4(),
        name: inputDTO.name,
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
          const KnexManager = (await import("../../database/KnexConnection"))
            .default;
          await RbacService.seedCompanyRbac(
            KnexManager.getConnection(),
            result.id,
          );
        }
      } catch (rbacErr) {
        console.error(
          "Failed to seed RBAC catalogue on company create:",
          rbacErr,
        );
      }

      res.status(201).json({
        success: true,
        data: result,
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

      const inputDTO = new CompanyUpdateInputDTO(data).build();
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

      const result = await this._companyDAO.delete(existing.id);

      if (result) {
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
      const knex =
        require("../../database/KnexConnection").default.getConnection();

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
