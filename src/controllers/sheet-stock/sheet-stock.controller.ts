import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { SheetStockDAO } from "../../dao/sheet-stock/sheet-stock.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { PaperSheetDAO } from "../../dao/paper-sheet/paper-sheet.dao";
import { ISheetStock } from "../../interfaces/sheet-stock/sheet-stock.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  SheetStockCreateInputDTO,
  SheetStockUpdateInputDTO,
} from "../../dto/input/sheetStock";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class SheetStockController implements IBaseController {
  private _sheetStockDAO: SheetStockDAO = new SheetStockDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<ISheetStock> =
        await this._sheetStockDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._sheetStockDAO.getWithDetails(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Sheet stock not found",
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

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Convert UUID foreign keys to numeric IDs
      if (data.warehouseId && typeof data.warehouseId === "string") {
        const warehouseDAO = new WarehouseDAO();
        const warehouseNumericId = await warehouseDAO.getIdByUuid(data.warehouseId);
        if (!warehouseNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid warehouse",
          });
          return;
        }
        data.warehouseId = warehouseNumericId;
      }

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

      if (data.paperSheetId && typeof data.paperSheetId === "string") {
        const paperSheetDAO = new PaperSheetDAO();
        const paperSheetNumericId = await paperSheetDAO.getIdByUuid(
          data.paperSheetId,
        );
        if (!paperSheetNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid paper sheet",
          });
          return;
        }
        data.paperSheetId = paperSheetNumericId;
      }

      // Convert warehouseLocationId UUID to numeric ID
      if (data.warehouseLocationId && typeof data.warehouseLocationId === "string") {
        const warehouseLocationDAO = new WarehouseLocationDAO();
        const locationNumericId = await warehouseLocationDAO.getIdByUuid(
          data.warehouseLocationId,
        );
        if (!locationNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid warehouse location",
          });
          return;
        }
        data.warehouseLocationId = locationNumericId;
      }

      // Validate input using DTO
      const inputDTO = new SheetStockCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: ISheetStock = {
        uuid: uuidv4(),
        warehouseId: inputDTO.warehouseId,
        warehouseLocationId: inputDTO.warehouseLocationId,
        supplierId: inputDTO.supplierId,
        manufacturerId: inputDTO.manufacturerId,
        paperSheetId: inputDTO.paperSheetId,
        comments: inputDTO.comments,
        price: inputDTO.price,
        quantity: inputDTO.quantity,
      };

      const result = await this._sheetStockDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get sheet stock by UUID to find its ID
      const existingId = await this._sheetStockDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Sheet stock not found",
        });
        return;
      }

      // Convert UUID foreign keys to numeric IDs
      if (data.warehouseId && typeof data.warehouseId === "string") {
        const warehouseDAO = new WarehouseDAO();
        const warehouseNumericId = await warehouseDAO.getIdByUuid(data.warehouseId);
        if (!warehouseNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid warehouse",
          });
          return;
        }
        data.warehouseId = warehouseNumericId;
      }

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

      if (data.paperSheetId && typeof data.paperSheetId === "string") {
        const paperSheetDAO = new PaperSheetDAO();
        const paperSheetNumericId = await paperSheetDAO.getIdByUuid(
          data.paperSheetId,
        );
        if (!paperSheetNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid paper sheet",
          });
          return;
        }
        data.paperSheetId = paperSheetNumericId;
      }

      // Convert warehouseLocationId UUID to numeric ID
      if (data.warehouseLocationId && typeof data.warehouseLocationId === "string") {
        const warehouseLocationDAO = new WarehouseLocationDAO();
        const locationNumericId = await warehouseLocationDAO.getIdByUuid(
          data.warehouseLocationId,
        );
        if (!locationNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid warehouse location",
          });
          return;
        }
        data.warehouseLocationId = locationNumericId;
      }

      // Validate input using DTO
      const inputDTO = new SheetStockUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._sheetStockDAO.update(existingId, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get sheet stock by UUID to find its ID
      const existingId = await this._sheetStockDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Sheet stock not found",
        });
        return;
      }

      const result = await this._sheetStockDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Sheet stock deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete sheet stock",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
