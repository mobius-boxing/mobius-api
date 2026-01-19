import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { IManufacturer } from "../../interfaces/manufacturer/manufacturer.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ManufacturerCreateInputDTO,
  ManufacturerUpdateInputDTO,
} from "../../dto/input/manufacturer";

export class ManufacturerController implements IBaseController {
  private _manufacturerDAO: ManufacturerDAO = new ManufacturerDAO();

  /**
   * Get all manufacturers with pagination, filtering, sorting, and search
   *
   * Query params (flat syntax):
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=code&sortOrder=asc)
   * - code, name: Filter by manufacturer code or name (ILIKE)
   * - search: Full-text search on code and name (e.g., ?search=TEST)
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result: IDataPaginator<IManufacturer> =
        await this._manufacturerDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get manufacturer by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._manufacturerDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Manufacturer not found",
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
   * Create a new manufacturer
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new ManufacturerCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IManufacturer = {
        uuid: uuidv4(),
        code: inputDTO.code,
        name: inputDTO.name,
      };

      const result = await this._manufacturerDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update manufacturer by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get manufacturer by UUID to find its ID
      const existing = await this._manufacturerDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Manufacturer not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new ManufacturerUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._manufacturerDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete manufacturer by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get manufacturer by UUID to find its ID
      const existing = await this._manufacturerDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Manufacturer not found",
        });
        return;
      }

      const result = await this._manufacturerDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Manufacturer deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete manufacturer",
        });
      }
    } catch (err: any) {
      // Handle foreign key constraint errors
      if (
        err.code === "23503" ||
        err.message?.includes("foreign key constraint")
      ) {
        res.status(400).json({
          success: false,
          message:
            "Cannot delete manufacturer: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }
}
