import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { BoxTypeDAO } from "../../dao/box-type/box-type.dao";
import { IBoxType } from "../../interfaces/box-type/box-type.interfaces";
import {
  BoxTypeCreateInputDTO,
  BoxTypeUpdateInputDTO,
} from "../../dto/input/boxType";
import { getCompanyForCreate } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

/**
 * BoxType — CRUD with Co-scope-A (companyId attached on create via inline
 * knex("companies") lookup).
 *
 * Query params (getAll):
 * - page, limit: Pagination
 * - sortBy, sortOrder: Sorting (code|name|createdAt|updatedAt, asc|desc)
 * - code, name, uuid: Filtering (ILIKE for code/name, = for uuid)
 * - search: Full-text search across code and name
 */
export class BoxTypeController extends BaseCrudController<IBoxType> {
  protected dao = new BoxTypeDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Box type",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new BoxTypeCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    // Mirror original explicit shape — code/name only; companyId added in beforeCreate.
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
    const inputDTO = new BoxTypeUpdateInputDTO(req.body).build();
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
      res.status(400).json({
        success: false,
        message: companyResult.message,
      });
      return null;
    }

    const knex = KnexManager.getConnection();
    const company = await knex("companies")
      .where("uuid", companyResult.companyUuid)
      .first();

    if (!company) {
      res.status(400).json({
        success: false,
        message: "Company not found",
      });
      return null;
    }

    return { ...payload, companyId: company.id };
  }
}
