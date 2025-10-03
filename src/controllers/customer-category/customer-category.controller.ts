import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { paginationHelper, inputValidator, IInputValidator } from "@sundaysf/utils";
import { CustomerCategoryDAO } from "../../dao/customer-category/customer-category.dao";
import { ICustomerCategory } from "../../interfaces/customer-category/customer-category.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import { CustomerCategoryCreateInputDTO, CustomerCategoryUpdateInputDTO } from "../../dto/input/customerCategory";

export class CustomerCategoryController implements IBaseController {
  private _customerCategoryDAO: CustomerCategoryDAO =
    new CustomerCategoryDAO();

  /**
   * Get all customer categories with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);
      const result: IDataPaginator<ICustomerCategory> =
        await this._customerCategoryDAO.getAll(page, limit);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get customer category by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._customerCategoryDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Customer category not found",
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

  /**
   * Create a new customer category
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new CustomerCategoryCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const dataToCreate: ICustomerCategory = {
        uuid: uuidv4(),
        customerCategoryUuid: uuidv4(),
        name: inputDTO.name,
        companyId: inputDTO.companyId,
      };

      const result = await this._customerCategoryDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update customer category by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get customer category by UUID to find its ID
      const existing = await this._customerCategoryDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer category not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new CustomerCategoryUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._customerCategoryDAO.update(
        existing.id,
        inputDTO
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete customer category by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get customer category by UUID to find its ID
      const existing = await this._customerCategoryDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer category not found",
        });
        return;
      }

      const result = await this._customerCategoryDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Customer category deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete customer category",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
