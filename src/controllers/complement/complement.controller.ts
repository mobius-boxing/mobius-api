import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ComplementDAO } from "../../dao/complement/complement.dao";
import { IComplement } from "../../interfaces/complement/complement.interfaces";
import {
  ComplementCreateInputDTO,
  ComplementUpdateInputDTO,
} from "../../dto/input/complement";
import { getCompanyForCreate } from "../../utils/companyScope";
import { db } from "../../database/registry";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ComplementController extends BaseCrudController<IComplement> {
  protected dao = new ComplementDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Complement",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ComplementCreateInputDTO(req.body).build();
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
    const inputDTO = new ComplementUpdateInputDTO(req.body).build();
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
