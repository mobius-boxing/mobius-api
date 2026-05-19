import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperTypeDAO } from "../../dao/paper-type/paper-type.dao";
import { IPaperType } from "../../interfaces/paper-type/paper-type.interfaces";
import {
  PaperTypeCreateInputDTO,
  PaperTypeUpdateInputDTO,
} from "../../dto/input/paperType";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class PaperTypeController extends BaseCrudController<IPaperType> {
  protected dao = new PaperTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Paper type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new PaperTypeCreateInputDTO(req.body).build();
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
    const inputDTO = new PaperTypeUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
