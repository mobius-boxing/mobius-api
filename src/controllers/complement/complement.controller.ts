import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ComplementDAO } from "../../dao/complement/complement.dao";
import { IComplement } from "../../interfaces/complement/complement.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ComplementCreateInputDTO,
  ComplementUpdateInputDTO,
} from "../../dto/input/complement";
import {
  enforceCompanyFilter,
  getCompanyForCreate,
} from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";

export class ComplementController implements IBaseController {
  private _complementDAO: ComplementDAO = new ComplementDAO();

  /**
   * Get all complements with pagination, filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (code, description, createdAt, updatedAt)
   * - code: Filter by code (ILIKE)
   * - description: Filter by description (ILIKE)
   * - search: Full-text search on code, description
   * - companyId: Filter by company UUID (SuperAdmin only, regular users are auto-filtered)
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // Enforce company filter for non-superAdmin users
      enforceCompanyFilter(req);

      const result = await this._complementDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get complement by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._complementDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Complement not found",
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
   * Create a new complement
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new ComplementCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Resolve company securely
      const companyResult = getCompanyForCreate(req);
      if (!companyResult.success) {
        res.status(400).json({
          success: false,
          message: companyResult.message,
        });
        return;
      }

      // Look up company ID from UUID
      const knex = KnexManager.getConnection();
      const company = await knex("companies")
        .where("uuid", companyResult.companyUuid)
        .first();

      if (!company) {
        res.status(400).json({
          success: false,
          message: "Company not found",
        });
        return;
      }

      // Generate UUID server-side
      const dataToCreate: IComplement = {
        uuid: uuidv4(),
        companyId: company.id,
        code: inputDTO.code,
        description: inputDTO.description,
      };

      const result = await this._complementDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update complement by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get complement by UUID to find its ID
      const existing = await this._complementDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Complement not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new ComplementUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._complementDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete complement by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get complement by UUID to find its ID
      const existing = await this._complementDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Complement not found",
        });
        return;
      }

      const result = await this._complementDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Complement deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete complement",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
