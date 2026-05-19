import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CorrugationClassDAO } from "../../dao/corrugation-class/corrugation-class.dao";
import { ICorrugationClass } from "../../interfaces/corrugation-class/corrugation-class.interfaces";
import {
  CorrugationClassCreateInputDTO,
  CorrugationClassUpdateInputDTO,
} from "../../dto/input/corrugationClass";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

/**
 * CorrugationClass — plain CRUD, no company scope, no FK resolution, no FK-catch.
 *
 * Query params (getAll):
 * - page, limit: Pagination
 * - sortBy, sortOrder: Sorting (code, description, createdAt, updatedAt)
 * - code: Filter by code (ILIKE)
 * - description: Filter by description (ILIKE)
 * - search: Full-text search on code, description
 */
export class CorrugationClassController extends BaseCrudController<ICorrugationClass> {
  protected dao = new CorrugationClassDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Corrugation class",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new CorrugationClassCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    // Mirror original create payload exactly (explicit fields, not spread).
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
    const inputDTO = new CorrugationClassUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }
}
