import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperSheetDAO } from "../../dao/paper-sheet/paper-sheet.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { CorrugationDAO } from "../../dao/corrugation/corrugation.dao";
import { IPaperSheet } from "../../interfaces/paper-sheet/paper-sheet.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  PaperSheetCreateInputDTO,
  PaperSheetUpdateInputDTO,
} from "../../dto/input/paperSheet";

export class PaperSheetController implements IBaseController {
  private _paperSheetDAO: PaperSheetDAO = new PaperSheetDAO();

  /**
   * Get all paper sheets with pagination, filtering, sorting, and search
   *
   * Supported query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (sortBy: code|name|length|width|minimumStock|createdAt|updatedAt)
   * - code, name, supplierId, manufacturerId, corrugationId: Filtering
   * - minLength, maxLength, minWidth, maxWidth: Range filters
   * - search: Full-text search across code, name, description
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result: IDataPaginator<IPaperSheet> =
        await this._paperSheetDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get paper sheet by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._paperSheetDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Paper sheet not found",
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
   * Create a new paper sheet
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Convert UUID foreign keys to numeric IDs BEFORE passing to DTO
      if (data.supplierId && typeof data.supplierId === "string") {
        const supplierDAO = new SupplierDAO();
        const supplierNumericId = await supplierDAO.getIdByUuid(data.supplierId);
        if (!supplierNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid supplier",
          });
          return;
        }
        data.supplierId = supplierNumericId;
      }

      if (data.manufacturerId && typeof data.manufacturerId === "string") {
        const manufacturerDAO = new ManufacturerDAO();
        const manufacturerNumericId = await manufacturerDAO.getIdByUuid(
          data.manufacturerId,
        );
        if (!manufacturerNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid manufacturer",
          });
          return;
        }
        data.manufacturerId = manufacturerNumericId;
      }

      if (data.corrugationId && typeof data.corrugationId === "string") {
        const corrugationDAO = new CorrugationDAO();
        const corrugationNumericId = await corrugationDAO.getIdByUuid(
          data.corrugationId,
        );
        if (!corrugationNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid corrugation",
          });
          return;
        }
        data.corrugationId = corrugationNumericId;
      }

      // Validate input using DTO
      const inputDTO = new PaperSheetCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IPaperSheet = {
        uuid: uuidv4(),
        code: inputDTO.code,
        name: inputDTO.name,
        description: inputDTO.description,
        supplierId: inputDTO.supplierId,
        manufacturerId: inputDTO.manufacturerId,
        corrugationId: inputDTO.corrugationId,
        minimumStock: inputDTO.minimumStock,
        length: inputDTO.length,
        width: inputDTO.width,
      };

      const result = await this._paperSheetDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update paper sheet by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get paper sheet by UUID to find its ID
      const existing = await this._paperSheetDAO.getByUuid(uuid);
      if (!existing) {
        res.status(404).json({
          success: false,
          message: "Paper sheet not found",
        });
        return;
      }

      // Get internal ID
      const existingId = await this._paperSheetDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Paper sheet not found",
        });
        return;
      }

      // Convert UUID foreign keys to numeric IDs
      if (data.supplierId && typeof data.supplierId === "string") {
        const supplierDAO = new SupplierDAO();
        const supplierNumericId = await supplierDAO.getIdByUuid(data.supplierId);
        if (!supplierNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid supplier",
          });
          return;
        }
        data.supplierId = supplierNumericId;
      }

      if (data.manufacturerId && typeof data.manufacturerId === "string") {
        const manufacturerDAO = new ManufacturerDAO();
        const manufacturerNumericId = await manufacturerDAO.getIdByUuid(
          data.manufacturerId,
        );
        if (!manufacturerNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid manufacturer",
          });
          return;
        }
        data.manufacturerId = manufacturerNumericId;
      }

      if (data.corrugationId && typeof data.corrugationId === "string") {
        const corrugationDAO = new CorrugationDAO();
        const corrugationNumericId = await corrugationDAO.getIdByUuid(
          data.corrugationId,
        );
        if (!corrugationNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid corrugation",
          });
          return;
        }
        data.corrugationId = corrugationNumericId;
      }

      // Validate input using DTO
      const inputDTO = new PaperSheetUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._paperSheetDAO.update(existingId, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete paper sheet by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get paper sheet by UUID to find its ID
      const existingId = await this._paperSheetDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Paper sheet not found",
        });
        return;
      }

      const result = await this._paperSheetDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Paper sheet deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete paper sheet",
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
            "Cannot delete paper sheet: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }
}
