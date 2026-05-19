import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { FlapTypeDAO } from "../../dao/flap-type/flap-type.dao";
import { IFlapType } from "../../interfaces/flap-type/flap-type.interfaces";
import {
  FlapTypeCreateInputDTO,
  FlapTypeUpdateInputDTO,
} from "../../dto/input/flapType";
import { getCompanyForCreate } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class FlapTypeController extends BaseCrudController<IFlapType> {
  protected dao = new FlapTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Flap type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new FlapTypeCreateInputDTO(req.body).build();
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
    const inputDTO = new FlapTypeUpdateInputDTO(req.body).build();
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

    const knex = KnexManager.getConnection();
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
