import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperClassDAO } from "../../dao/paper-class/paper-class.dao";
import { IPaperClass } from "../../interfaces/paper-class/paper-class.interfaces";
import {
  PaperClassCreateInputDTO,
  PaperClassUpdateInputDTO,
} from "../../dto/input/paperClass";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class PaperClassController extends BaseCrudController<IPaperClass> {
  protected dao = new PaperClassDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Paper class",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new PaperClassCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      code: inputDTO.code,
      name: inputDTO.name,
      papers: inputDTO.papers,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new PaperClassUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
