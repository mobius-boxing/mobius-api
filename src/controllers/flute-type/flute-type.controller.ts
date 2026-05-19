import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { FluteTypeDAO } from "../../dao/flute-type/flute-type.dao";
import { IFluteType } from "../../interfaces/flute-type/flute-type.interfaces";
import {
  FluteTypeCreateInputDTO,
  FluteTypeUpdateInputDTO,
} from "../../dto/input/fluteType";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class FluteTypeController extends BaseCrudController<IFluteType> {
  protected dao = new FluteTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Flute type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new FluteTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      description: inputDTO.description,
      fluteFactor: inputDTO.fluteFactor,
      length: inputDTO.length,
      width: inputDTO.width,
      height: inputDTO.height,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new FluteTypeUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
