import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { CustomerCategoryDAO } from "../../dao/customer-category/customer-category.dao";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CustomerCreateInputDTO,
  CustomerUpdateInputDTO,
} from "../../dto/input/customer";

export class CustomerController implements IBaseController {
  private _customerDAO: CustomerDAO = new CustomerDAO();

  /**
   * Get all customers with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      // Extract companyId - SuperAdmin sees all, others see only their company
      const user = (req as any).user;
      const companyId = user.role === "superAdmin" ? undefined : user.companyId;

      const result: IDataPaginator<ICustomer> = await this._customerDAO.getAll(
        page,
        limit,
        companyId,
      );
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get customer by UUID
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

      const result = await this._customerDAO.getByUuid(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
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
   * Create a new customer
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
            message: "User must belong to a company to create customers",
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

      // Convert UUID foreign keys to numeric IDs BEFORE passing to DTO
      if (data.salesPersonId && typeof data.salesPersonId === "string") {
        const userDAO = new UserDAO();
        const userNumericId = await userDAO.getIdByUuid(data.salesPersonId);
        if (!userNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid sales person",
          });
          return;
        }
        data.salesPersonId = userNumericId;
      }

      if (data.categoryId && typeof data.categoryId === "string") {
        const categoryDAO = new CustomerCategoryDAO();
        const categoryNumericId = await categoryDAO.getIdByUuid(
          data.categoryId,
        );
        if (!categoryNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid category",
          });
          return;
        }
        data.categoryId = categoryNumericId;
      }

      // Validate input using DTO
      const inputDTO = new CustomerCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: ICustomer = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        name: inputDTO.name,
        supplierCode: inputDTO.supplierCode,
        salesPersonId: inputDTO.salesPersonId,
        categoryId: inputDTO.categoryId,
        active: true,
        legalName: inputDTO.legalName,
        address: inputDTO.address,
        tradeName: inputDTO.tradeName,
        contacts: inputDTO.contacts || [],
        deliveryLocations: inputDTO.deliveryLocations || [],
        deliveryDays: inputDTO.deliveryDays || [],
      };

      const result = await this._customerDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update customer by UUID
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

      // Get customer by UUID to find its ID and verify ownership
      const existing = await this._customerDAO.getByUuid(uuid, companyId);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
        });
        return;
      }

      // Convert UUID foreign keys to numeric IDs BEFORE passing to DTO
      if (data.salesPersonId && typeof data.salesPersonId === "string") {
        const userDAO = new UserDAO();
        const userNumericId = await userDAO.getIdByUuid(data.salesPersonId);
        if (!userNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid sales person",
          });
          return;
        }
        data.salesPersonId = userNumericId;
      }

      if (data.categoryId && typeof data.categoryId === "string") {
        const categoryDAO = new CustomerCategoryDAO();
        const categoryNumericId = await categoryDAO.getIdByUuid(
          data.categoryId,
        );
        if (!categoryNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid category",
          });
          return;
        }
        data.categoryId = categoryNumericId;
      }

      // Validate input using DTO
      const inputDTO = new CustomerUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._customerDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete customer by UUID
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

      // Get customer by UUID to find its ID and verify ownership
      const existing = await this._customerDAO.getByUuid(uuid, companyId);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
        });
        return;
      }

      const result = await this._customerDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Customer deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete customer",
        });
      }
    } catch (err: any) {
      // Handle foreign key constraint errors
      if (
        err.code === "23503" ||
        err.message?.includes("foreign key constraint")
      ) {
        res.status(400).json({
          success: false,
          message:
            "Cannot delete customer: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }

  /**
   * Get customer with related details (company, category, sales person)
   */
  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const user = (req as any).user;
      const companyId = user.role === "superAdmin" ? undefined : user.companyId;

      const result = await this._customerDAO.getCustomerWithDetails(
        uuid,
        companyId,
      );

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
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
}
