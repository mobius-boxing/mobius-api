import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { TraceTypeDAO } from "../../dao/trace-type/trace-type.dao";
import { ITraceType } from "../../interfaces/trace-type/trace-type.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  TraceTypeCreateInputDTO,
  TraceTypeUpdateInputDTO,
} from "../../dto/input/traceType";
import {
  enforceCompanyFilter,
  getCompanyForCreate,
} from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";

export class TraceTypeController implements IBaseController {
  private _traceTypeDAO: TraceTypeDAO = new TraceTypeDAO();

  /**
   * Get all trace types with pagination, filtering, sorting, and search
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

      const result = await this._traceTypeDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get trace type by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._traceTypeDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Trace type not found",
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
   * Create a new trace type
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new TraceTypeCreateInputDTO(data).build();
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
      const dataToCreate: ITraceType = {
        uuid: uuidv4(),
        companyId: company.id,
        code: inputDTO.code,
        description: inputDTO.description,
      };

      const result = await this._traceTypeDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update trace type by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get trace type by UUID to find its ID
      const existing = await this._traceTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Trace type not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new TraceTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._traceTypeDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete trace type by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get trace type by UUID to find its ID
      const existing = await this._traceTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Trace type not found",
        });
        return;
      }

      const result = await this._traceTypeDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Trace type deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete trace type",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
