import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { PaperSupplyDAO } from "../../dao/paper-supply/paper-supply.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { IPaperSupply } from "../../interfaces/paper-supply/paper-supply.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  PaperSupplyCreateInputDTO,
  PaperSupplyUpdateInputDTO,
} from "../../dto/input/paperSupply";
import { getCompanyFilterUuid } from "../../utils/companyScope";

export class PaperSupplyController implements IBaseController {
  private _paperSupplyDAO: PaperSupplyDAO = new PaperSupplyDAO();

  /**
   * Get all paper supplies with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      // Extract companyId - SuperAdmin sees all, others see only their company
      const companyId = getCompanyFilterUuid(req);

      const result: IDataPaginator<IPaperSupply> =
        await this._paperSupplyDAO.getAll(page, limit, companyId);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get paper supply by UUID
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

      const result = await this._paperSupplyDAO.getByUuid(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Paper supply not found",
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
   * Create a new paper supply
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
            message: "User must belong to a company to create paper supplies",
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
      if (data.manufacturerId && typeof data.manufacturerId === "string") {
        const manufacturerDAO = new ManufacturerDAO();
        const manufacturerNumericId = await manufacturerDAO.getIdByUuid(
          data.manufacturerId,
        );
        if (!manufacturerNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid manufacturer",
          });
          return;
        }
        data.manufacturerId = manufacturerNumericId;
      }

      if (data.supplierId && typeof data.supplierId === "string") {
        const supplierDAO = new SupplierDAO();
        const supplierNumericId = await supplierDAO.getIdByUuid(
          data.supplierId,
        );
        if (!supplierNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid supplier",
          });
          return;
        }
        data.supplierId = supplierNumericId;
      }

      // Validate input using DTO
      const inputDTO = new PaperSupplyCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IPaperSupply = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        code: inputDTO.code,
        description: inputDTO.description,
        name: inputDTO.name,
        manufacturerId: inputDTO.manufacturerId,
        supplierId: inputDTO.supplierId,
        minimumStock: inputDTO.minimumStock,
      };

      const result = await this._paperSupplyDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update paper supply by UUID
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

      // Get paper supply by UUID to find its ID and verify ownership
      const existing = await this._paperSupplyDAO.getByUuid(uuid, companyId);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Paper supply not found",
        });
        return;
      }

      // Convert UUID foreign keys to numeric IDs BEFORE passing to DTO
      if (data.manufacturerId && typeof data.manufacturerId === "string") {
        const manufacturerDAO = new ManufacturerDAO();
        const manufacturerNumericId = await manufacturerDAO.getIdByUuid(
          data.manufacturerId,
        );
        if (!manufacturerNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid manufacturer",
          });
          return;
        }
        data.manufacturerId = manufacturerNumericId;
      }

      if (data.supplierId && typeof data.supplierId === "string") {
        const supplierDAO = new SupplierDAO();
        const supplierNumericId = await supplierDAO.getIdByUuid(
          data.supplierId,
        );
        if (!supplierNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid supplier",
          });
          return;
        }
        data.supplierId = supplierNumericId;
      }

      // Validate input using DTO
      const inputDTO = new PaperSupplyUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._paperSupplyDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete paper supply by UUID
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

      // Get paper supply by UUID to find its ID and verify ownership
      const existing = await this._paperSupplyDAO.getByUuid(uuid, companyId);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Paper supply not found",
        });
        return;
      }

      const result = await this._paperSupplyDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Paper supply deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete paper supply",
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
            "Cannot delete paper supply: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }

  /**
   * Get paper supply with related details (manufacturer, supplier, company)
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

      const result = await this._paperSupplyDAO.getWithDetails(
        uuid,
        companyId,
      );

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Paper supply not found",
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
