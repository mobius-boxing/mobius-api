import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ISupplier } from "../../interfaces/supplier/supplier.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  SupplierCreateInputDTO,
  SupplierUpdateInputDTO,
} from "../../dto/input/supplier";

export class SupplierController implements IBaseController {
  private _supplierDAO: SupplierDAO = new SupplierDAO();

  /**
   * Get all suppliers with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      const result: IDataPaginator<ISupplier> =
        await this._supplierDAO.getAll(page, limit);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get supplier by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._supplierDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Supplier not found",
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
   * Create a new supplier
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new SupplierCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: ISupplier = {
        uuid: uuidv4(),
        code: inputDTO.code,
        suppliesSheets: inputDTO.suppliesSheets,
        suppliesElaborated: inputDTO.suppliesElaborated,
        suppliesConsumables: inputDTO.suppliesConsumables,
        suppliesPaper: inputDTO.suppliesPaper,
        suppliesTooling: inputDTO.suppliesTooling,
      };

      const result = await this._supplierDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update supplier by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get supplier by UUID to find its ID
      const existing = await this._supplierDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Supplier not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new SupplierUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._supplierDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete supplier by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get supplier by UUID to find its ID
      const existing = await this._supplierDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Supplier not found",
        });
        return;
      }

      const result = await this._supplierDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Supplier deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete supplier",
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
            "Cannot delete supplier: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }
}
