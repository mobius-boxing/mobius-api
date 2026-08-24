import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { BoxTypeDAO } from "../../dao/box-type/box-type.dao";
import { IBoxType } from "../../interfaces/box-type/box-type.interfaces";
import {
  BoxTypeCreateInputDTO,
  BoxTypeUpdateInputDTO,
} from "../../dto/input/boxType";
import { getCompanyForCreate } from "../../utils/companyScope";
import { db } from "../../database/registry";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class BoxTypeController extends BaseCrudController<IBoxType> {
  protected dao = new BoxTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Box type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new BoxTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      name: inputDTO.name,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new BoxTypeUpdateInputDTO(req.body).build();
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
      res.status(400).json({
        success: false,
        message: companyResult.message,
      });
      return null;
    }

    const knex = db("core");
    const company = await knex("companies")
      .where("uuid", companyResult.companyUuid)
      .first();

    if (!company) {
      res.status(400).json({
        success: false,
        message: "Company not found",
      });
      return null;
    }

    return { ...payload, companyId: company.id };
  }
}
