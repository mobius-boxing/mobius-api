import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ICompany } from "../../interfaces/company/company.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CompanyCreateInputDTO,
  CompanyUpdateInputDTO,
} from "../../dto/input/company";

export class CompaniesController implements IBaseController {
  private _companyDAO: CompanyDAO = new CompanyDAO();

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
      const knex = require("../../database/KnexConnection").default.getConnection();

      const [totalResult, activeResult] = await Promise.all([
        knex("companies").count("* as count").first(),
        knex("companies").where("isActive", true).count("* as count").first(),
      ]);

      const companiesWithUsersResult = await knex("companies")
        .whereExists(function(this: any) {
          this.select(knex.raw(1))
            .from("users")
            .whereRaw('"users"."companyId" = "companies"."id"');
        })
        .count("* as count")
        .first();

      const totalCompanies = parseInt(totalResult?.count as string) || 0;
      const totalUsersResult = await knex("users").count("* as count").first();
      const totalUsers = parseInt(totalUsersResult?.count as string) || 0;
      const averageUsersPerCompany = totalCompanies > 0
        ? Math.round((totalUsers / totalCompanies) * 100) / 100
        : 0;

      const stats = {
        totalCompanies,
        activeCompanies: parseInt(activeResult?.count as string) || 0,
        companiesWithUsers: parseInt(companiesWithUsersResult?.count as string) || 0,
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
