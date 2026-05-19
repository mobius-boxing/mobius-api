import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ProductTypeDAO } from "../../dao/product-type/product-type.dao";
import { IProductType } from "../../interfaces/product-type/product-type.interfaces";
import { v4 as uuidv4 } from "uuid";
import {
  ProductTypeCreateInputDTO,
  ProductTypeUpdateInputDTO,
} from "../../dto/input/productType";
import {
  enforceCompanyFilter,
  getCompanyForCreate,
} from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";

export class ProductTypeController implements IBaseController {
  private _dao: ProductTypeDAO = new ProductTypeDAO();

  /**
   * Get all product types with pagination, filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (code|name|createdAt|updatedAt, asc|desc)
   * - code, name, uuid: Filtering (ILIKE for code/name, = for uuid)
   * - search: Full-text search across code and name
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result = await this._dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._dao.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Product type not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      const inputDTO = new ProductTypeCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const companyResult = getCompanyForCreate(req);
      if (!companyResult.success) {
        res.status(400).json({
          success: false,
          message: companyResult.message,
        });
        return;
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
        return;
      }

      const dataToCreate: IProductType = {
        uuid: uuidv4(),
        companyId: company.id,
        code: inputDTO.code,
        name: inputDTO.name,
      };

      const result = await this._dao.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const existingId = await this._dao.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Product type not found",
        });
        return;
      }

      const inputDTO = new ProductTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._dao.update(existingId, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const existingId = await this._dao.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Product type not found",
        });
        return;
      }

      const result = await this._dao.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Product type deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete product type",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
