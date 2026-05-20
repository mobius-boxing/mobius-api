import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { StoreRollDAO } from "../../dao/store-roll/store-roll.dao";
import { IStoreRoll } from "../../interfaces/store-roll/store-roll.interfaces";
import {
  StoreRollCreateInputDTO,
  StoreRollUpdateInputDTO,
} from "../../dto/input/storeRoll";
import { getCompanyForCreate } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class StoreRollController extends BaseCrudController<IStoreRoll> {
  protected dao = new StoreRollDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Store roll",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new StoreRollCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }

    if (
      typeof inputDTO.description !== "string" ||
      inputDTO.description.trim() === ""
    ) {
      req.statusCode = 400;
      next(new Error("description is required"));
      return null;
    }
    if (!Number.isInteger(inputDTO.minQuantity) || inputDTO.minQuantity < 1) {
      req.statusCode = 400;
      next(new Error("minQuantity must be an integer >= 1"));
      return null;
    }

    return {
      description: inputDTO.description,
      minQuantity: inputDTO.minQuantity,
      isActive: inputDTO.isActive,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new StoreRollUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }

    // Partial update: validate only the fields actually present (mirror create rules).
    if (
      inputDTO.description !== undefined &&
      (typeof inputDTO.description !== "string" || inputDTO.description.trim() === "")
    ) {
      req.statusCode = 400;
      next(new Error("description must be a non-empty string"));
      return null;
    }
    if (
      inputDTO.minQuantity !== undefined &&
      (!Number.isInteger(inputDTO.minQuantity) || inputDTO.minQuantity <= 0)
    ) {
      req.statusCode = 400;
      next(new Error("minQuantity must be a positive integer"));
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
