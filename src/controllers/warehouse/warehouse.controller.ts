import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { IWarehouse } from "../../interfaces/warehouse/warehouse.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  WarehouseCreateInputDTO,
  WarehouseUpdateInputDTO,
} from "../../dto/input/warehouse";

export class WarehouseController implements IBaseController {
  private _warehouseDAO: WarehouseDAO = new WarehouseDAO();

  /**
   * Get all warehouses with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      const result: IDataPaginator<IWarehouse> =
        await this._warehouseDAO.getAll(page, limit);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get warehouse by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._warehouseDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
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
   * Create a new warehouse
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new WarehouseCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IWarehouse = {
        uuid: uuidv4(),
        name: inputDTO.name,
      };

      const result = await this._warehouseDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update warehouse by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get warehouse by UUID to find its ID
      const existing = await this._warehouseDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new WarehouseUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._warehouseDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete warehouse by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get warehouse by UUID to find its ID
      const existing = await this._warehouseDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const result = await this._warehouseDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Warehouse deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete warehouse",
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
            "Cannot delete warehouse: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }
}
