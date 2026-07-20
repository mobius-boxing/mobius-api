import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ColorDAO } from "../../dao/color/color.dao";
import { ColorTypeDAO } from "../../dao/color-type/color-type.dao";
import { IColor } from "../../interfaces/color/color.interfaces";
import {
  ColorCreateInputDTO,
  ColorUpdateInputDTO,
} from "../../dto/input/color";
import { getCompanyForCreate } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ColorController extends BaseCrudController<IColor> {
  protected dao = new ColorDAO();
  private colorTypeDAO = new ColorTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Color",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete color: consumable supplies reference it. Remove or reassign them first.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ColorCreateInputDTO(req.body).build();
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
    const inputDTO = new ColorUpdateInputDTO(req.body).build();
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

    // SECURITY: resolve client-supplied UUID to internal numeric ID before storing.
    let colorTypeId: number | undefined;
    if (payload.colorTypeUuid) {
      const resolved = await this.colorTypeDAO.getIdByUuid(payload.colorTypeUuid);
      if (!resolved) {
        res.status(400).json({ success: false, message: "Color type not found" });
        return null;
      }
      colorTypeId = resolved;
    }

    return {
      code: payload.code,
      name: payload.name,
      description: payload.description,
      observations: payload.observations,
      tonality: payload.tonality,
      colorTypeId,
      companyId: company.id,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: any = { ...inputDTO };
    delete updateData.colorTypeUuid;

    if (inputDTO.colorTypeUuid) {
      const colorTypeId = await this.colorTypeDAO.getIdByUuid(
        inputDTO.colorTypeUuid,
      );
      if (!colorTypeId) {
        res.status(400).json({ success: false, message: "Color type not found" });
        return null;
      }
      updateData.colorTypeId = colorTypeId;
    } else if (inputDTO.colorTypeUuid === null) {
      updateData.colorTypeId = null;
    }

    return updateData;
  }
}
