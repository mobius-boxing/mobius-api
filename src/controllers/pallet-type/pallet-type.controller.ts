import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PalletTypeDAO } from "../../dao/pallet-type/pallet-type.dao";
import { IPalletType } from "../../interfaces/palletization/palletization.interfaces";
import {
  PalletTypeCreateInputDTO,
  PalletTypeUpdateInputDTO,
} from "../../dto/input/palletization";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { getCompanyForCreate } from "../../utils/companyScope";

export class PalletTypeController extends BaseCrudController<IPalletType> {
  protected dao = new PalletTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Pallet type",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete pallet type: palletizations still reference it.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new PalletTypeCreateInputDTO(req.body).build();
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
    const inputDTO = new PalletTypeUpdateInputDTO(req.body).build();
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
