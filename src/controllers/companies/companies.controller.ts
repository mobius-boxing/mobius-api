import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
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

  /**
   * Get all companies with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);
      const result: IDataPaginator<ICompany> = await this._companyDAO.getAll(
        page,
        limit,
      );
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get company by UUID
   */
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

  /**
   * Create a new company
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
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

  /**
   * Update company by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get company by UUID to find its ID
      const existing = await this._companyDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Company not found",
        });
        return;
      }

      // Validate input using DTO
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

  /**
   * Delete company by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get company by UUID to find its ID
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
   * Get company with user count
   */
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
