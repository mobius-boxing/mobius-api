import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ColorTypeDAO } from "../../dao/color-type/color-type.dao";
import { IColorType } from "../../interfaces/color-type/color-type.interfaces";
import {
  ColorTypeCreateInputDTO,
  ColorTypeUpdateInputDTO,
} from "../../dto/input/colorType";
import { getCompanyForCreate } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ColorTypeController extends BaseCrudController<IColorType> {
  protected dao = new ColorTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Color type",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete color type: colors reference it. Remove or reassign them first.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ColorTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      name: inputDTO.name,
      description: inputDTO.description,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ColorTypeUpdateInputDTO(req.body).build();
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
