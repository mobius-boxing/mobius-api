import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ConsumableTypeDAO } from "../../dao/consumable-type/consumable-type.dao";
import { IConsumableType } from "../../interfaces/consumable-type/consumable-type.interfaces";
import { ConsumableTypeCreateInputDTO } from "../../dto/input/consumable-type/ConsumableTypeCreateInputDTO";
import { ConsumableTypeUpdateInputDTO } from "../../dto/input/consumable-type/ConsumableTypeUpdateInputDTO";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ConsumableTypeController extends BaseCrudController<IConsumableType> {
  protected dao = new ConsumableTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Consumable type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ConsumableTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      name: inputDTO.name,
      autoConsumption: inputDTO.autoConsumption ?? false,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ConsumableTypeUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
