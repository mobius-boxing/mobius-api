import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { SheetStockDAO } from "../../dao/sheet-stock/sheet-stock.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { PaperSheetDAO } from "../../dao/paper-sheet/paper-sheet.dao";
import { ISheetStock } from "../../interfaces/sheet-stock/sheet-stock.interfaces";
import {
  SheetStockCreateInputDTO,
  SheetStockUpdateInputDTO,
} from "../../dto/input/sheetStock";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class SheetStockController extends BaseCrudController<ISheetStock> {
  protected dao = new SheetStockDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Sheet stock",
  };

  protected async getOneByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<ISheetStock | null> {
    // SECURITY (C2): ownership gate via the company-scoped getByUuid before returning details.
    if (companyUuid && !(await this.dao.getByUuid(uuid, companyUuid))) {
      return null;
    }
    return this.dao.getWithDetails(uuid);
  }

  private async resolveForeignKeys(data: any, res: Response): Promise<boolean> {
    if (data.warehouseId && typeof data.warehouseId === "string") {
      const warehouseDAO = new WarehouseDAO();
      const id = await warehouseDAO.getIdByUuid(data.warehouseId);
      if (!id) {
        res.status(400).json({ success: false, message: "Invalid warehouse" });
        return false;
      }
      data.warehouseId = id;
    }

    if (data.supplierId && typeof data.supplierId === "string") {
      const supplierDAO = new SupplierDAO();
      const id = await supplierDAO.getIdByUuid(data.supplierId);
      if (!id) {
        res.status(400).json({ success: false, message: "Invalid supplier" });
        return false;
      }
      data.supplierId = id;
    }

    if (data.manufacturerId && typeof data.manufacturerId === "string") {
      const manufacturerDAO = new ManufacturerDAO();
      const id = await manufacturerDAO.getIdByUuid(data.manufacturerId);
      if (!id) {
        res
          .status(400)
          .json({ success: false, message: "Invalid manufacturer" });
        return false;
      }
      data.manufacturerId = id;
    }

    if (data.paperSheetId && typeof data.paperSheetId === "string") {
      const paperSheetDAO = new PaperSheetDAO();
      const id = await paperSheetDAO.getIdByUuid(data.paperSheetId);
      if (!id) {
        res
          .status(400)
          .json({ success: false, message: "Invalid paper sheet" });
        return false;
      }
      data.paperSheetId = id;
    }

    if (
      data.warehouseLocationId &&
      typeof data.warehouseLocationId === "string"
    ) {
      const warehouseLocationDAO = new WarehouseLocationDAO();
      const id = await warehouseLocationDAO.getIdByUuid(
        data.warehouseLocationId,
      );
      if (!id) {
        res
          .status(400)
          .json({ success: false, message: "Invalid warehouse location" });
        return false;
      }
      data.warehouseLocationId = id;
    }

    return true;
  }

  protected async buildCreateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const ok = await this.resolveForeignKeys(req.body, res);
    if (!ok) return null;

    const inputDTO = new SheetStockCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }

    return {
      warehouseId: inputDTO.warehouseId,
      warehouseLocationId: inputDTO.warehouseLocationId,
      supplierId: inputDTO.supplierId,
      manufacturerId: inputDTO.manufacturerId,
      paperSheetId: inputDTO.paperSheetId,
      comments: inputDTO.comments,
      price: inputDTO.price,
      quantity: inputDTO.quantity,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const ok = await this.resolveForeignKeys(req.body, res);
    if (!ok) return null;

    const inputDTO = new SheetStockUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
