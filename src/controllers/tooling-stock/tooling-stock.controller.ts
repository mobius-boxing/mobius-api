import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ToolingStockDAO } from "../../dao/tooling-stock/tooling-stock.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { ToolingDAO } from "../../dao/tooling/tooling.dao";
import { IToolingStock } from "../../interfaces/tooling-stock/tooling-stock.interfaces";
import { ToolingStockCreateInputDTO } from "../../dto/input/tooling-stock/ToolingStockCreateInputDTO";
import { ToolingStockUpdateInputDTO } from "../../dto/input/tooling-stock/ToolingStockUpdateInputDTO";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ToolingStockController extends BaseCrudController<IToolingStock> {
  protected dao = new ToolingStockDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Tooling stock",
  };

  private _warehouseDAO = new WarehouseDAO();
  private _warehouseLocationDAO = new WarehouseLocationDAO();
  private _supplierDAO = new SupplierDAO();
  private _manufacturerDAO = new ManufacturerDAO();
  private _toolingDAO = new ToolingDAO();

  protected async getOneByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IToolingStock | null> {
    // SECURITY (C2): ownership gate via the company-scoped getByUuid before returning details.
    if (companyUuid && !(await this.dao.getByUuid(uuid, companyUuid))) {
      return null;
    }
    return this.dao.getWithDetails(uuid);
  }

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ToolingStockCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ToolingStockUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async beforeCreate(
    inputDTO: any,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const warehouseId = await this._warehouseDAO.getIdByUuid(
      inputDTO.warehouseUuid,
    );
    if (!warehouseId) {
      res.status(400).json({ success: false, message: "Warehouse not found" });
      return null;
    }

    const toolingId = await this._toolingDAO.getIdByUuid(inputDTO.toolingUuid);
    if (!toolingId) {
      res.status(400).json({ success: false, message: "Tooling not found" });
      return null;
    }

    let warehouseLocationId: number | undefined;
    let supplierId: number | undefined;
    let manufacturerId: number | undefined;

    if (inputDTO.warehouseLocationUuid) {
      warehouseLocationId =
        (await this._warehouseLocationDAO.getIdByUuid(
          inputDTO.warehouseLocationUuid,
        )) ?? undefined;
      if (!warehouseLocationId) {
        res
          .status(400)
          .json({ success: false, message: "Warehouse location not found" });
        return null;
      }
    }

    if (inputDTO.supplierUuid) {
      supplierId =
        (await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid)) ??
        undefined;
      if (!supplierId) {
        res.status(400).json({ success: false, message: "Supplier not found" });
        return null;
      }
    }

    if (inputDTO.manufacturerUuid) {
      manufacturerId =
        (await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid)) ??
        undefined;
      if (!manufacturerId) {
        res
          .status(400)
          .json({ success: false, message: "Manufacturer not found" });
        return null;
      }
    }

    return {
      warehouseId,
      warehouseLocationId,
      supplierId,
      manufacturerId,
      toolingId,
      comments: inputDTO.comments,
      price: inputDTO.price,
      quantity: inputDTO.quantity,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: Partial<IToolingStock> = {};

    if (inputDTO.comments !== undefined)
      updateData.comments = inputDTO.comments;
    if (inputDTO.price !== undefined) updateData.price = inputDTO.price;
    if (inputDTO.quantity !== undefined)
      updateData.quantity = inputDTO.quantity;

    if (inputDTO.warehouseUuid !== undefined) {
      const warehouseId = await this._warehouseDAO.getIdByUuid(
        inputDTO.warehouseUuid,
      );
      if (!warehouseId) {
        res
          .status(400)
          .json({ success: false, message: "Warehouse not found" });
        return null;
      }
      updateData.warehouseId = warehouseId;
    }

    if (inputDTO.toolingUuid !== undefined) {
      const toolingId = await this._toolingDAO.getIdByUuid(
        inputDTO.toolingUuid,
      );
      if (!toolingId) {
        res.status(400).json({ success: false, message: "Tooling not found" });
        return null;
      }
      updateData.toolingId = toolingId;
    }

    if (inputDTO.warehouseLocationUuid !== undefined) {
      if (inputDTO.warehouseLocationUuid === "") {
        updateData.warehouseLocationId = undefined;
      } else {
        const warehouseLocationId =
          await this._warehouseLocationDAO.getIdByUuid(
            inputDTO.warehouseLocationUuid,
          );
        if (!warehouseLocationId) {
          res
            .status(400)
            .json({ success: false, message: "Warehouse location not found" });
          return null;
        }
        updateData.warehouseLocationId = warehouseLocationId;
      }
    }

    if (inputDTO.supplierUuid !== undefined) {
      if (inputDTO.supplierUuid === "") {
        updateData.supplierId = undefined;
      } else {
        const supplierId = await this._supplierDAO.getIdByUuid(
          inputDTO.supplierUuid,
        );
        if (!supplierId) {
          res
            .status(400)
            .json({ success: false, message: "Supplier not found" });
          return null;
        }
        updateData.supplierId = supplierId;
      }
    }

    if (inputDTO.manufacturerUuid !== undefined) {
      if (inputDTO.manufacturerUuid === "") {
        updateData.manufacturerId = undefined;
      } else {
        const manufacturerId = await this._manufacturerDAO.getIdByUuid(
          inputDTO.manufacturerUuid,
        );
        if (!manufacturerId) {
          res
            .status(400)
            .json({ success: false, message: "Manufacturer not found" });
          return null;
        }
        updateData.manufacturerId = manufacturerId;
      }
    }

    return updateData;
  }
}
