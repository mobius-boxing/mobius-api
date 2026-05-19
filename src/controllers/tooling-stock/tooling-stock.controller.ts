import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ToolingStockDAO } from "../../dao/tooling-stock/tooling-stock.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { ToolingDAO } from "../../dao/tooling/tooling.dao";
import { IToolingStock } from "../../interfaces/tooling-stock/tooling-stock.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { ToolingStockCreateInputDTO } from "../../dto/input/tooling-stock/ToolingStockCreateInputDTO";
import { ToolingStockUpdateInputDTO } from "../../dto/input/tooling-stock/ToolingStockUpdateInputDTO";
import { v4 as uuidv4 } from "uuid";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class ToolingStockController implements IBaseController {
  private _toolingStockDAO: ToolingStockDAO = new ToolingStockDAO();
  private _warehouseDAO: WarehouseDAO = new WarehouseDAO();
  private _warehouseLocationDAO: WarehouseLocationDAO = new WarehouseLocationDAO();
  private _supplierDAO: SupplierDAO = new SupplierDAO();
  private _manufacturerDAO: ManufacturerDAO = new ManufacturerDAO();
  private _toolingDAO: ToolingDAO = new ToolingDAO();

  /**
   * Get all tooling stock with filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting
   * - warehouseId, toolingId, supplierId, manufacturerId: Filtering
   * - minPrice, maxPrice, minQuantity, maxQuantity: Range filters
   * - search: Full-text search on comments
   */
  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IToolingStock> = await this._toolingStockDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._toolingStockDAO.getWithDetails(uuid);

      if (!result) {
        res.status(404).json({ success: false, message: "Tooling stock not found" });
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

  public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body;
      const inputDTO = new ToolingStockCreateInputDTO(data).build();

      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Resolve required foreign keys
      const warehouseId = await this._warehouseDAO.getIdByUuid(inputDTO.warehouseUuid);
      if (!warehouseId) {
        res.status(400).json({ success: false, message: "Warehouse not found" });
        return;
      }

      const toolingId = await this._toolingDAO.getIdByUuid(inputDTO.toolingUuid);
      if (!toolingId) {
        res.status(400).json({ success: false, message: "Tooling not found" });
        return;
      }

      // Resolve optional foreign keys
      let warehouseLocationId: number | undefined;
      let supplierId: number | undefined;
      let manufacturerId: number | undefined;

      if (inputDTO.warehouseLocationUuid) {
        warehouseLocationId = await this._warehouseLocationDAO.getIdByUuid(inputDTO.warehouseLocationUuid) ?? undefined;
        if (!warehouseLocationId) {
          res.status(400).json({ success: false, message: "Warehouse location not found" });
          return;
        }
      }

      if (inputDTO.supplierUuid) {
        supplierId = await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid) ?? undefined;
        if (!supplierId) {
          res.status(400).json({ success: false, message: "Supplier not found" });
          return;
        }
      }

      if (inputDTO.manufacturerUuid) {
        manufacturerId = await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid) ?? undefined;
        if (!manufacturerId) {
          res.status(400).json({ success: false, message: "Manufacturer not found" });
          return;
        }
      }

      const dataToCreate: IToolingStock = {
        uuid: uuidv4(),
        warehouseId,
        warehouseLocationId,
        supplierId,
        manufacturerId,
        toolingId,
        comments: inputDTO.comments,
        price: inputDTO.price,
        quantity: inputDTO.quantity,
      };

      const result = await this._toolingStockDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const existingId = await this._toolingStockDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Tooling stock not found" });
        return;
      }

      const inputDTO = new ToolingStockUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const updateData: Partial<IToolingStock> = {};

      if (inputDTO.comments !== undefined) updateData.comments = inputDTO.comments;
      if (inputDTO.price !== undefined) updateData.price = inputDTO.price;
      if (inputDTO.quantity !== undefined) updateData.quantity = inputDTO.quantity;

      if (inputDTO.warehouseUuid !== undefined) {
        const warehouseId = await this._warehouseDAO.getIdByUuid(inputDTO.warehouseUuid);
        if (!warehouseId) {
          res.status(400).json({ success: false, message: "Warehouse not found" });
          return;
        }
        updateData.warehouseId = warehouseId;
      }

      if (inputDTO.toolingUuid !== undefined) {
        const toolingId = await this._toolingDAO.getIdByUuid(inputDTO.toolingUuid);
        if (!toolingId) {
          res.status(400).json({ success: false, message: "Tooling not found" });
          return;
        }
        updateData.toolingId = toolingId;
      }

      if (inputDTO.warehouseLocationUuid !== undefined) {
        if (inputDTO.warehouseLocationUuid === "") {
          updateData.warehouseLocationId = undefined;
        } else {
          const warehouseLocationId = await this._warehouseLocationDAO.getIdByUuid(inputDTO.warehouseLocationUuid);
          if (!warehouseLocationId) {
            res.status(400).json({ success: false, message: "Warehouse location not found" });
            return;
          }
          updateData.warehouseLocationId = warehouseLocationId;
        }
      }

      if (inputDTO.supplierUuid !== undefined) {
        if (inputDTO.supplierUuid === "") {
          updateData.supplierId = undefined;
        } else {
          const supplierId = await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid);
          if (!supplierId) {
            res.status(400).json({ success: false, message: "Supplier not found" });
            return;
          }
          updateData.supplierId = supplierId;
        }
      }

      if (inputDTO.manufacturerUuid !== undefined) {
        if (inputDTO.manufacturerUuid === "") {
          updateData.manufacturerId = undefined;
        } else {
          const manufacturerId = await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid);
          if (!manufacturerId) {
            res.status(400).json({ success: false, message: "Manufacturer not found" });
            return;
          }
          updateData.manufacturerId = manufacturerId;
        }
      }

      const result = await this._toolingStockDAO.update(existingId, updateData);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;

      const existingId = await this._toolingStockDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Tooling stock not found" });
        return;
      }

      const result = await this._toolingStockDAO.delete(existingId);

      if (result) {
        res.status(200).json({ success: true, message: "Tooling stock deleted successfully" });
      } else {
        res.status(404).json({ success: false, message: "Failed to delete tooling stock" });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
