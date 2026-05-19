import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperStockDAO } from "../../dao/paper-stock/paper-stock.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { PaperSupplyDAO } from "../../dao/paper-supply/paper-supply.dao";
import { IPaperStock } from "../../interfaces/paper-stock/paper-stock.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  PaperStockCreateInputDTO,
  PaperStockUpdateInputDTO,
} from "../../dto/input/paperStock";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class PaperStockController implements IBaseController {
  private _paperStockDAO: PaperStockDAO = new PaperStockDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IPaperStock> =
        await this._paperStockDAO.getAllWithFilters(req);
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
      const result = await this._paperStockDAO.getWithDetails(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Paper stock not found",
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

      if (data.paperSupplyId && typeof data.paperSupplyId === "string") {
        const paperSupplyDAO = new PaperSupplyDAO();
        const paperSupplyNumericId = await paperSupplyDAO.getIdByUuid(
          data.paperSupplyId,
        );
        if (!paperSupplyNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid paper supply",
          });
          return;
        }
        data.paperSupplyId = paperSupplyNumericId;
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
      const inputDTO = new PaperStockCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IPaperStock = {
        uuid: uuidv4(),
        warehouseId: inputDTO.warehouseId,
        warehouseLocationId: inputDTO.warehouseLocationId,
        supplierId: inputDTO.supplierId,
        manufacturerId: inputDTO.manufacturerId,
        paperSupplyId: inputDTO.paperSupplyId,
        comments: inputDTO.comments,
        price: inputDTO.price,
        weight: inputDTO.weight,
        diameter: inputDTO.diameter,
        width: inputDTO.width,
      };

      const result = await this._paperStockDAO.create(dataToCreate);

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

      // Get paper stock by UUID to find its ID
      const existingId = await this._paperStockDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Paper stock not found",
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

      if (data.paperSupplyId && typeof data.paperSupplyId === "string") {
        const paperSupplyDAO = new PaperSupplyDAO();
        const paperSupplyNumericId = await paperSupplyDAO.getIdByUuid(
          data.paperSupplyId,
        );
        if (!paperSupplyNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid paper supply",
          });
          return;
        }
        data.paperSupplyId = paperSupplyNumericId;
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
      const inputDTO = new PaperStockUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._paperStockDAO.update(existingId, inputDTO);

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

      // Get paper stock by UUID to find its ID
      const existingId = await this._paperStockDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Paper stock not found",
        });
        return;
      }

      const result = await this._paperStockDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Paper stock deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete paper stock",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
