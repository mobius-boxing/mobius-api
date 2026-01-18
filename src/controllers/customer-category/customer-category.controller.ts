import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { CustomerCategoryDAO } from "../../dao/customer-category/customer-category.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ICustomerCategory } from "../../interfaces/customer-category/customer-category.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CustomerCategoryCreateInputDTO,
  CustomerCategoryUpdateInputDTO,
} from "../../dto/input/customerCategory";

export class CustomerCategoryController implements IBaseController {
  private _customerCategoryDAO: CustomerCategoryDAO = new CustomerCategoryDAO();

  /**
   * Get all customer categories with pagination and filtering
   * Uses query builder for flexible querying
   * SuperAdmin: filters by companyId from query params (frontend sends selected company UUID)
   * Regular users: always filtered by their assigned company
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = (req as any).user;

      // For non-superAdmin users, enforce their company filter
      if (user.role !== "superAdmin" && user.companyId) {
        // Override/set the companyId query param with user's company UUID
        req.query.companyId = user.companyId;
      }

      const result: IDataPaginator<ICustomerCategory> =
        await this._customerCategoryDAO.getAllWithFilters(req);
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
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const user = (req as any).user;
      const companyId = user.role === "superAdmin" ? undefined : user.companyId;

      const result = await this._customerCategoryDAO.getByUuid(uuid, companyId);

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
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const user = (req as any).user;

      // Determine companyId based on user role
      let companyIdNumeric: number;

      if (user.role === "superAdmin") {
        // SuperAdmin can create for any company - companyId must be provided in request
        if (!data.companyId) {
          res.status(400).json({
            success: false,
            message: "SuperAdmin must specify a company",
          });
          return;
        }
        // CompanyId from frontend might be UUID or numeric - convert if needed
        const companyDAO = new CompanyDAO();
        const numericId =
          typeof data.companyId === "string"
            ? await companyDAO.getIdByUuid(data.companyId)
            : data.companyId;
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid company",
          });
          return;
        }
        companyIdNumeric = numericId;
      } else {
        // Regular user - extract from token (cannot be changed)
        if (!user.companyId) {
          res.status(400).json({
            success: false,
            message: "User must belong to a company to create customer categories",
          });
          return;
        }
        // Convert company UUID from token to numeric ID
        const companyDAO = new CompanyDAO();
        const numericId = await companyDAO.getIdByUuid(user.companyId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid company",
          });
          return;
        }
        companyIdNumeric = numericId;
      }

      // Inject the resolved companyId
      data.companyId = companyIdNumeric;

      // Validate input using DTO
      const inputDTO = new CustomerCategoryCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: ICustomerCategory = {
        uuid: uuidv4(),
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
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const user = (req as any).user;
      const companyId = user.role === "superAdmin" ? undefined : user.companyId;

      // Get customer category by UUID to find its ID and verify ownership
      const existing = await this._customerCategoryDAO.getByUuid(
        uuid,
        companyId,
      );
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
        inputDTO,
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
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const user = (req as any).user;
      const companyId = user.role === "superAdmin" ? undefined : user.companyId;

      // Get customer category by UUID to find its ID and verify ownership
      const existing = await this._customerCategoryDAO.getByUuid(
        uuid,
        companyId,
      );
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
