import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ISupplier } from "../../interfaces/supplier/supplier.interfaces";
import {
  SupplierCreateInputDTO,
  SupplierUpdateInputDTO,
} from "../../dto/input/supplier";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

/**
 * Supplier — plain CRUD with FK-catch on delete.
 */
export class SupplierController extends BaseCrudController<ISupplier> {
  protected dao = new SupplierDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Supplier",
    fkCatchOnDelete: true,
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new SupplierCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      suppliesSheets: inputDTO.suppliesSheets,
      suppliesElaborated: inputDTO.suppliesElaborated,
      suppliesConsumables: inputDTO.suppliesConsumables,
      suppliesPaper: inputDTO.suppliesPaper,
      suppliesTooling: inputDTO.suppliesTooling,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new SupplierUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
