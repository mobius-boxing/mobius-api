import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { FscTypeDAO } from "../../dao/fsc-type/fsc-type.dao";
import { IFscType } from "../../interfaces/fsc-type/fsc-type.interfaces";
import {
  FscTypeCreateInputDTO,
  FscTypeUpdateInputDTO,
} from "../../dto/input/fscType";
import { getCompanyForCreate } from "../../utils/companyScope";
import { db } from "../../database/registry";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class FscTypeController extends BaseCrudController<IFscType> {
  protected dao = new FscTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "FSC type",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete FSC type: paper supplies reference it. Remove or reassign them first.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new FscTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      description: inputDTO.description,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new FscTypeUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async beforeCreate(
    payload: any,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const companyResult = getCompanyForCreate(req);
    if (!companyResult.success) {
      res.status(400).json({ success: false, message: companyResult.message });
      return null;
    }

    const knex = db("core");
    const company = await knex("companies")
      .where("uuid", companyResult.companyUuid)
      .first();
    if (!company) {
      res.status(400).json({ success: false, message: "Company not found" });
      return null;
    }

    return { ...payload, companyId: company.id };
  }
}
