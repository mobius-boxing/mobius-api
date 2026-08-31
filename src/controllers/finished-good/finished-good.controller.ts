import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { FinishedGoodDAO } from "../../dao/finished-good/finished-good.dao";
import { IFinishedGood } from "../../interfaces/finished-good/finished-good.interfaces";
import {
  FinishedGoodCreateInputDTO,
  FinishedGoodUpdateInputDTO,
} from "../../dto/input/finished-good";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { getCompanyForCreate } from "../../utils/companyScope";

export class FinishedGoodController extends BaseCrudController<IFinishedGood> {
  protected dao = new FinishedGoodDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Finished good",
    fkCatchOnDelete: true,
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new FinishedGoodCreateInputDTO(req.body).build();
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
    const inputDTO = new FinishedGoodUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  private async resolveRefs(
    inputDTO: any,
    res: Response,
  ): Promise<Record<string, number | null> | null> {
    const resolved: Record<string, number | null> = {};
    if (inputDTO.supplierUuid !== undefined) {
      const supplierId = inputDTO.supplierUuid
        ? await getIdByUuid(inputDTO.supplierUuid, "suppliers")
        : null;
      if (inputDTO.supplierUuid && !supplierId) {
        res.status(400).json({ success: false, message: "Supplier not found" });
        return null;
      }
      resolved.supplierId = supplierId;
    }
    if (inputDTO.manufacturerUuid !== undefined) {
      const manufacturerId = inputDTO.manufacturerUuid
        ? await getIdByUuid(inputDTO.manufacturerUuid, "manufacturers")
        : null;
      if (inputDTO.manufacturerUuid && !manufacturerId) {
        res
          .status(400)
          .json({ success: false, message: "Manufacturer not found" });
        return null;
      }
      resolved.manufacturerId = manufacturerId;
    }
    return resolved;
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

    const refs = await this.resolveRefs(inputDTO, res);
    if (refs === null) return null;

    return {
      code: inputDTO.code,
      name: inputDTO.name,
      description: inputDTO.description,
      minimumStock: inputDTO.minimumStock,
      companyId,
      ...refs,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: any = { ...inputDTO };
    delete updateData.supplierUuid;
    delete updateData.manufacturerUuid;

    const refs = await this.resolveRefs(inputDTO, res);
    if (refs === null) return null;

    return { ...updateData, ...refs };
  }
}
