import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperStockDAO } from "../../dao/paper-stock/paper-stock.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { PaperSupplyDAO } from "../../dao/paper-supply/paper-supply.dao";
import { IPaperStock } from "../../interfaces/paper-stock/paper-stock.interfaces";
import {
  PaperStockCreateInputDTO,
  PaperStockUpdateInputDTO,
} from "../../dto/input/paperStock";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

/**
 * PaperStock — CRUD with 5 FK UUID→ID resolutions and a getByUuid override
 * that returns the enriched payload from dao.getWithDetails(uuid).
 *
 * FKs (numeric-id keyed DTO, no empty-string-clears semantics on update):
 *   - warehouseId, supplierId, manufacturerId, paperSupplyId, warehouseLocationId
 *
 * Frontend sends these as string UUIDs; controller resolves to numeric IDs
 * (mutates req.body in-place before DTO validation, mirroring original).
 */
export class PaperStockController extends BaseCrudController<IPaperStock> {
  protected dao = new PaperStockDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Paper stock",
  };

  /** Override: GET /:uuid returns the rich joined payload, not the bare row. */
  protected async getOneByUuid(uuid: string): Promise<IPaperStock | null> {
    return this.dao.getWithDetails(uuid);
  }

  /**
   * Resolve all 5 FK UUIDs → numeric IDs on the raw request body in-place,
   * exactly as the original controller did. Returns true on success, false if
   * an error response was already written.
   */
  private async resolveForeignKeys(
    data: any,
    res: Response,
  ): Promise<boolean> {
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

    if (data.paperSupplyId && typeof data.paperSupplyId === "string") {
      const paperSupplyDAO = new PaperSupplyDAO();
      const id = await paperSupplyDAO.getIdByUuid(data.paperSupplyId);
      if (!id) {
        res
          .status(400)
          .json({ success: false, message: "Invalid paper supply" });
        return false;
      }
      data.paperSupplyId = id;
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
    // Original sequence: FK resolution BEFORE DTO validation.
    const ok = await this.resolveForeignKeys(req.body, res);
    if (!ok) return null;

    const inputDTO = new PaperStockCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }

    // Mirror original explicit-field create payload.
    return {
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
  }

  protected async buildUpdateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const ok = await this.resolveForeignKeys(req.body, res);
    if (!ok) return null;

    const inputDTO = new PaperStockUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }

    // Original passes inputDTO directly to dao.update.
    return inputDTO;
  }
}
