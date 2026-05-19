import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { ProductDAO } from "../../dao/product/product.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { ProductTypeDAO } from "../../dao/product-type/product-type.dao";
import { BoxTypeDAO } from "../../dao/box-type/box-type.dao";
import { IProduct } from "../../interfaces/product/product.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ProductCreateInputDTO,
  ProductUpdateInputDTO,
} from "../../dto/input/product";
import { enforceCompanyFilter, getCompanyFilterUuid } from "../../utils/companyScope";

export class ProductController implements IBaseController {
  private _productDAO: ProductDAO = new ProductDAO();

  /**
   * Get all products with pagination and filtering
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
      // For non-superAdmin users, enforce their company filter
      enforceCompanyFilter(req);

      const result: IDataPaginator<IProduct> =
        await this._productDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get product by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const companyId = getCompanyFilterUuid(req);

      const result = await this._productDAO.getByUuid(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Product not found",
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
   * Create a new product
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
            message: "User must belong to a company to create products",
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
      if (data.customerId && typeof data.customerId === "string") {
        const customerDAO = new CustomerDAO();
        const customerNumericId = await customerDAO.getIdByUuid(
          data.customerId,
        );
        if (!customerNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid customer",
          });
          return;
        }
        data.customerId = customerNumericId;
      }

      if (data.productTypeId && typeof data.productTypeId === "string") {
        const productTypeDAO = new ProductTypeDAO();
        const numericId = await productTypeDAO.getIdByUuid(data.productTypeId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid product type",
          });
          return;
        }
        data.productTypeId = numericId;
      }

      if (data.boxTypeId && typeof data.boxTypeId === "string") {
        const boxTypeDAO = new BoxTypeDAO();
        const numericId = await boxTypeDAO.getIdByUuid(data.boxTypeId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid box type",
          });
          return;
        }
        data.boxTypeId = numericId;
      }

      // Validate input using DTO
      const inputDTO = new ProductCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IProduct = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        code: inputDTO.code,
        clientCode: inputDTO.clientCode,
        description: inputDTO.description,
        customerId: inputDTO.customerId,
        revision: inputDTO.revision,
        vip: inputDTO.vip,
        productTypeId: inputDTO.productTypeId,
        boxTypeId: inputDTO.boxTypeId,
      };

      const result = await this._productDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update product by UUID
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
      const companyId = getCompanyFilterUuid(req);

      // Get product numeric ID by UUID, verifying ownership via company scope
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      // Convert UUID foreign keys to numeric IDs BEFORE passing to DTO
      if (data.customerId && typeof data.customerId === "string") {
        const customerDAO = new CustomerDAO();
        const customerNumericId = await customerDAO.getIdByUuid(
          data.customerId,
        );
        if (!customerNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid customer",
          });
          return;
        }
        data.customerId = customerNumericId;
      }

      if (data.productTypeId && typeof data.productTypeId === "string") {
        const productTypeDAO = new ProductTypeDAO();
        const numericId = await productTypeDAO.getIdByUuid(data.productTypeId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid product type",
          });
          return;
        }
        data.productTypeId = numericId;
      }

      if (data.boxTypeId && typeof data.boxTypeId === "string") {
        const boxTypeDAO = new BoxTypeDAO();
        const numericId = await boxTypeDAO.getIdByUuid(data.boxTypeId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid box type",
          });
          return;
        }
        data.boxTypeId = numericId;
      }

      // Validate input using DTO
      const inputDTO = new ProductUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._productDAO.update(existingId, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete product by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const companyId = getCompanyFilterUuid(req);

      // Get product numeric ID by UUID, verifying ownership via company scope
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      const result = await this._productDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Product deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete product",
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
            "Cannot delete product: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }

  /**
   * Get product with related details (customer)
   */
  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Extract companyId - SuperAdmin sees all, others see only their company
      const companyId = getCompanyFilterUuid(req);

      const result = await this._productDAO.getWithDetails(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Product not found",
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
