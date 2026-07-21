import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PalletizationDAO } from "../../dao/palletization/palletization.dao";
import { PalletTypeDAO } from "../../dao/pallet-type/pallet-type.dao";
import { IPalletization } from "../../interfaces/palletization/palletization.interfaces";
import {
  PalletizationCreateInputDTO,
  PalletizationUpdateInputDTO,
} from "../../dto/input/palletization";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import {
  getCompanyForCreate,
  getCompanyFilterUuid,
} from "../../utils/companyScope";

export class PalletizationController extends BaseCrudController<IPalletization> {
  protected dao = new PalletizationDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Palletization",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete palletization: parts still reference it.",
  };

  private palletTypeDAO = new PalletTypeDAO();

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new PalletizationCreateInputDTO(req.body).build();
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
    const inputDTO = new PalletizationUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  /** Resolve palletTypeUuid → palletTypeId; validate file uuids exist. */
  private async resolveRefs(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<Record<string, any> | null> {
    const resolved: Record<string, any> = {};
    const companyUuid = getCompanyFilterUuid(req);

    if (inputDTO.palletTypeUuid !== undefined) {
      if (!inputDTO.palletTypeUuid) {
        resolved.palletTypeId = null;
      } else {
        const palletTypeId = await this.palletTypeDAO.getIdByUuid(
          inputDTO.palletTypeUuid,
          companyUuid,
        );
        if (!palletTypeId) {
          res.status(400).json({ success: false, message: "Pallet type not found" });
          return null;
        }
        resolved.palletTypeId = palletTypeId;
      }
    }

    for (const key of ["technicalFileUuid", "imageFileUuid"] as const) {
      if (inputDTO[key]) {
        const fileId = await getIdByUuid(inputDTO[key], "files");
        if (!fileId) {
          res.status(400).json({ success: false, message: `File not found (${key})` });
          return null;
        }
      }
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

    const refs = await this.resolveRefs(inputDTO, req, res);
    if (refs === null) return null;

    const payload: any = { ...inputDTO, ...refs, companyId };
    delete payload.palletTypeUuid;
    return payload;
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const refs = await this.resolveRefs(inputDTO, req, res);
    if (refs === null) return null;

    const payload: any = { ...inputDTO, ...refs };
    delete payload.palletTypeUuid;
    return payload;
  }
}
