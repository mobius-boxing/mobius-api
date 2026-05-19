import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { FluteTypeDAO } from "../../dao/flute-type/flute-type.dao";
import { IFluteType } from "../../interfaces/flute-type/flute-type.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  FluteTypeCreateInputDTO,
  FluteTypeUpdateInputDTO,
} from "../../dto/input/fluteType";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class FluteTypeController implements IBaseController {
  private _fluteTypeDAO: FluteTypeDAO = new FluteTypeDAO();

  /**
   * Get all flute types with pagination, filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (code, description, fluteFactor, length, width, height, createdAt, updatedAt)
   * - code: Filter by code (ILIKE)
   * - description: Filter by description (ILIKE)
   * - search: Full-text search on code, description
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result = await this._fluteTypeDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get flute type by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._fluteTypeDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Flute type not found",
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
   * Create a new flute type
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new FluteTypeCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IFluteType = {
        uuid: uuidv4(),
        code: inputDTO.code,
        description: inputDTO.description,
        fluteFactor: inputDTO.fluteFactor,
        length: inputDTO.length,
        width: inputDTO.width,
        height: inputDTO.height,
      };

      const result = await this._fluteTypeDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update flute type by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get flute type by UUID to find its ID
      const existing = await this._fluteTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Flute type not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new FluteTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._fluteTypeDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete flute type by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get flute type by UUID to find its ID
      const existing = await this._fluteTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Flute type not found",
        });
        return;
      }

      const result = await this._fluteTypeDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Flute type deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete flute type",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
