import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { IWarehouseLocation } from "../../interfaces/warehouseLocation/warehouseLocation.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  WarehouseLocationCreateInputDTO,
  WarehouseLocationUpdateInputDTO,
  WarehouseLocationBatchUpdateInputDTO,
} from "../../dto/input/warehouseLocation";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class WarehouseLocationController implements IBaseController {
  private _warehouseLocationDAO: WarehouseLocationDAO = new WarehouseLocationDAO();
  private _warehouseDAO: WarehouseDAO = new WarehouseDAO();

  /**
   * Get all warehouse locations with pagination, filtering, sorting, and search
   *
   * Query params (flat syntax):
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=row&sortOrder=asc)
   * - warehouseId, status, locationType, locationCode: Filtering (e.g., ?warehouseId=5&status=active)
   * - search: Full-text search across locationCode (e.g., ?search=A-05)
   *
   * Examples:
   * - GET /warehouse-locations?page=1&limit=10
   * - GET /warehouse-locations?sortBy=row&sortOrder=asc
   * - GET /warehouse-locations?warehouseId=3&status=active
   * - GET /warehouse-locations?search=A-
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IWarehouseLocation> =
        await this._warehouseLocationDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get all locations for a specific warehouse (no pagination)
   */
  public async getByWarehouse(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { warehouseUuid } = req.params;

      // Get warehouse ID from UUID
      const warehouseId = await this._warehouseDAO.getIdByUuid(warehouseUuid);
      if (!warehouseId) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const result = await this._warehouseLocationDAO.getAllByWarehouseId(warehouseId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get warehouse location by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._warehouseLocationDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Warehouse location not found",
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
   * Create a new warehouse location
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new WarehouseLocationCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IWarehouseLocation = {
        uuid: uuidv4(),
        warehouseId: inputDTO.warehouseId,
        row: inputDTO.row,
        col: inputDTO.col,
        status: inputDTO.status,
        locationType: inputDTO.locationType,
        locationCode: inputDTO.locationCode,
        capacity: inputDTO.capacity,
        metadata: inputDTO.metadata,
      };

      const result = await this._warehouseLocationDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Batch update warehouse locations
   */
  public async batchUpdate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { warehouseUuid } = req.params;
      const data = req.body;

      // Get warehouse ID from UUID
      const warehouseId = await this._warehouseDAO.getIdByUuid(warehouseUuid);
      if (!warehouseId) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new WarehouseLocationBatchUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._warehouseLocationDAO.batchUpdate(
        warehouseId,
        inputDTO.locations
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update warehouse location by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get location by UUID to find its ID
      const existing = await this._warehouseLocationDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse location not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new WarehouseLocationUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._warehouseLocationDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete warehouse location by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get location by UUID to find its ID
      const existing = await this._warehouseLocationDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse location not found",
        });
        return;
      }

      const result = await this._warehouseLocationDAO.delete(existing.id);

      if (result) {
        res.status(200).json({ success: true, message: "Warehouse location deleted successfully" });
      } else {
        res.status(404).json({ success: false, message: "Failed to delete warehouse location" });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
