import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperClassDAO } from "../../dao/paper-class/paper-class.dao";
import { IPaperClass } from "../../interfaces/paper-class/paper-class.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  PaperClassCreateInputDTO,
  PaperClassUpdateInputDTO,
} from "../../dto/input/paperClass";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class PaperClassController implements IBaseController {
  private _paperClassDAO: PaperClassDAO = new PaperClassDAO();

  /**
   * Get all paper classes with pagination, filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (code, name, createdAt, updatedAt)
   * - code: Filter by code (ILIKE)
   * - name: Filter by name (ILIKE)
   * - search: Full-text search on code, name
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result = await this._paperClassDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get paper class by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._paperClassDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Paper class not found",
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
   * Create a new paper class
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new PaperClassCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IPaperClass = {
        uuid: uuidv4(),
        code: inputDTO.code,
        name: inputDTO.name,
        papers: inputDTO.papers,
      };

      const result = await this._paperClassDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update paper class by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get paper class by UUID to find its ID
      const existing = await this._paperClassDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Paper class not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new PaperClassUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._paperClassDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete paper class by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get paper class by UUID to find its ID
      const existing = await this._paperClassDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Paper class not found",
        });
        return;
      }

      const result = await this._paperClassDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Paper class deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete paper class",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
