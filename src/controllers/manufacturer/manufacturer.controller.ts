import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { IManufacturer } from "../../interfaces/manufacturer/manufacturer.interfaces";
import {
  ManufacturerCreateInputDTO,
  ManufacturerUpdateInputDTO,
} from "../../dto/input/manufacturer";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

/**
 * Manufacturer — plain CRUD with FK-catch on delete.
 */
export class ManufacturerController extends BaseCrudController<IManufacturer> {
  protected dao = new ManufacturerDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Manufacturer",
    fkCatchOnDelete: true,
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ManufacturerCreateInputDTO(req.body).build();
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
    const inputDTO = new ManufacturerUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
