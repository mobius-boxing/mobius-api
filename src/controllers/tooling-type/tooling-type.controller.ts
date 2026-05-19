import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ToolingTypeDAO } from "../../dao/tooling-type/tooling-type.dao";
import { IToolingType } from "../../interfaces/tooling-type/tooling-type.interfaces";
import {
  ToolingTypeCreateInputDTO,
  ToolingTypeUpdateInputDTO,
} from "../../dto/input/toolingType";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ToolingTypeController extends BaseCrudController<IToolingType> {
  protected dao = new ToolingTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Tooling type",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete tooling type: it is referenced by toolings. Please remove related data first.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ToolingTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      name: inputDTO.name,
      description: inputDTO.description,
      automaticConsumption: inputDTO.automaticConsumption,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ToolingTypeUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
