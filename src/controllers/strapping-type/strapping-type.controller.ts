import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { StrappingTypeDAO } from "../../dao/strapping-type/strapping-type.dao";
import { IStrappingType } from "../../interfaces/strapping-type/strapping-type.interfaces";
import {
  StrappingTypeCreateInputDTO,
  StrappingTypeUpdateInputDTO,
} from "../../dto/input/strappingType";
import { getCompanyForCreate } from "../../utils/companyScope";
import { db } from "../../database/registry";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class StrappingTypeController extends BaseCrudController<IStrappingType> {
  protected dao = new StrappingTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Strapping type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new StrappingTypeCreateInputDTO(req.body).build();
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
    const inputDTO = new StrappingTypeUpdateInputDTO(req.body).build();
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
