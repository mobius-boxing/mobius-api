import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperSheetDAO } from "../../dao/paper-sheet/paper-sheet.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { CorrugationDAO } from "../../dao/corrugation/corrugation.dao";
import { IPaperSheet } from "../../interfaces/paper-sheet/paper-sheet.interfaces";
import {
  PaperSheetCreateInputDTO,
  PaperSheetUpdateInputDTO,
} from "../../dto/input/paperSheet";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class PaperSheetController extends BaseCrudController<IPaperSheet> {
  protected dao = new PaperSheetDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Paper sheet",
    fkCatchOnDelete: true,
  };

  private async resolveForeignKeys(data: any, res: Response): Promise<boolean> {
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

    if (data.corrugationId && typeof data.corrugationId === "string") {
      const corrugationDAO = new CorrugationDAO();
      const id = await corrugationDAO.getIdByUuid(data.corrugationId);
      if (!id) {
        res
          .status(400)
          .json({ success: false, message: "Invalid corrugation" });
        return false;
      }
      data.corrugationId = id;
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

    const inputDTO = new PaperSheetCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }

    return {
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
  }

  protected async buildUpdateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const ok = await this.resolveForeignKeys(req.body, res);
    if (!ok) return null;

    const inputDTO = new PaperSheetUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
