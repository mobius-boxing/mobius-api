import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { FlapTypeDAO } from "../../dao/flap-type/flap-type.dao";
import { IFlapType } from "../../interfaces/flap-type/flap-type.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  FlapTypeCreateInputDTO,
  FlapTypeUpdateInputDTO,
} from "../../dto/input/flapType";
import {
  enforceCompanyFilter,
  getCompanyForCreate,
} from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";

export class FlapTypeController implements IBaseController {
  private _flapTypeDAO: FlapTypeDAO = new FlapTypeDAO();

  /**
   * Get all flap types with pagination, filtering, sorting, and search
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

      const result = await this._flapTypeDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get flap type by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._flapTypeDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Flap type not found",
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
   * Create a new flap type
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new FlapTypeCreateInputDTO(data).build();
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
      const dataToCreate: IFlapType = {
        uuid: uuidv4(),
        companyId: company.id,
        code: inputDTO.code,
        description: inputDTO.description,
      };

      const result = await this._flapTypeDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update flap type by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get flap type by UUID to find its ID
      const existing = await this._flapTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Flap type not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new FlapTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._flapTypeDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete flap type by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get flap type by UUID to find its ID
      const existing = await this._flapTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Flap type not found",
        });
        return;
      }

      const result = await this._flapTypeDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Flap type deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete flap type",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
