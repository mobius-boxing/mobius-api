import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { StoreBoxDAO } from "../../dao/store-box/store-box.dao";
import { IStoreBox } from "../../interfaces/store-box/store-box.interfaces";
import {
  StoreBoxCreateInputDTO,
  StoreBoxUpdateInputDTO,
} from "../../dto/input/storeBox";
import { getCompanyForCreate } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class StoreBoxController extends BaseCrudController<IStoreBox> {
  protected dao = new StoreBoxDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Store box",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new StoreBoxCreateInputDTO(req.body).build();
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
    if (!Number.isInteger(inputDTO.unitsPerPackage) || inputDTO.unitsPerPackage <= 0) {
      req.statusCode = 400;
      next(new Error("unitsPerPackage must be a positive integer"));
      return null;
    }
    if (!Number.isInteger(inputDTO.unitsPerPallet) || inputDTO.unitsPerPallet <= 0) {
      req.statusCode = 400;
      next(new Error("unitsPerPallet must be a positive integer"));
      return null;
    }

    return {
      description: inputDTO.description,
      unitsPerPackage: inputDTO.unitsPerPackage,
      unitsPerPallet: inputDTO.unitsPerPallet,
      isActive: inputDTO.isActive,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new StoreBoxUpdateInputDTO(req.body).build();
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
      inputDTO.unitsPerPackage !== undefined &&
      (!Number.isInteger(inputDTO.unitsPerPackage) || inputDTO.unitsPerPackage <= 0)
    ) {
      req.statusCode = 400;
      next(new Error("unitsPerPackage must be a positive integer"));
      return null;
    }
    if (
      inputDTO.unitsPerPallet !== undefined &&
      (!Number.isInteger(inputDTO.unitsPerPallet) || inputDTO.unitsPerPallet <= 0)
    ) {
      req.statusCode = 400;
      next(new Error("unitsPerPallet must be a positive integer"));
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
