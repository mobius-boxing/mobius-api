import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { MachineTypeDAO } from "../../dao/machine-type/machine-type.dao";
import { IMachineType } from "../../interfaces/machine/machine.interfaces";
import {
  MachineTypeCreateInputDTO,
  MachineTypeUpdateInputDTO,
} from "../../dto/input/machine";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { getCompanyForCreate } from "../../utils/companyScope";

export class MachineTypeController extends BaseCrudController<IMachineType> {
  protected dao = new MachineTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Machine type",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete machine type: machines or route stages still reference it.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    let inputDTO: any;
    try {
      inputDTO = new MachineTypeCreateInputDTO(req.body).build();
    } catch (e: any) {
      // DTO build() throws are validation failures (CLAUDE.md validation rule).
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
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
    let inputDTO: any;
    try {
      inputDTO = new MachineTypeUpdateInputDTO(req.body).build();
    } catch (e: any) {
      // DTO build() throws are validation failures (CLAUDE.md validation rule).
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  /** I-5: a type cannot stop being a supplier while a machine maps to one. */
  protected async beforeUpdate(
    inputDTO: any,
    existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    if (inputDTO.isSupplier === false) {
      const mapped = await this.dao.countMachinesWithSupplier(existingId);
      if (mapped > 0) {
        res.status(409).json({
          success: false,
          code: "MACHINE_TYPE_HAS_SUPPLIER_MACHINES",
          message:
            "Cannot unset isSupplier: machines of this type are still mapped to a supplier.",
        });
        return null;
      }
    }
    return inputDTO;
  }

  protected async beforeCreate(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const company = getCompanyForCreate(req);
    if (!company.success) {
      res.status(400).json({ success: false, message: company.message });
      return null;
    }
    const companyId = await getIdByUuid(company.companyUuid, "companies");
    if (!companyId) {
      res.status(400).json({ success: false, message: "Company not found" });
      return null;
    }
    return { ...inputDTO, companyId };
  }
}
