import { Request, Response, NextFunction } from "express";
import { AuditService } from "../../services/audit.service";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { UserDAO } from "../../dao/user/user.dao";
import { CustomerCategoryDAO } from "../../dao/customer-category/customer-category.dao";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4, validate as isUUID } from "uuid";
import {
  CustomerCreateInputDTO,
  CustomerUpdateInputDTO,
} from "../../dto/input/customer";
import {
  enforceCompanyFilter,
  getCompanyFilterUuid,
} from "../../utils/companyScope";

export class CustomerController implements IBaseController {
  private _audit = new AuditService();

  /** Best-effort audit hook (audit_logs) — fire-and-forget. */
  private recordAudit(
    req: any,
    op: "Alta" | "Baja" | "Modificacion",
    entity: any,
  ): void {
    void this._audit.record(req, "Customer", op, entity ?? null);
  }

  private _customerDAO: CustomerDAO = new CustomerDAO();

  /**
   * SuperAdmin: filters by companyId from query params.
   * Regular users: always filtered by their assigned company (enforced server-side).
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);

      const result: IDataPaginator<ICustomer> =
        await this._customerDAO.getAllWithFilters(req);
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

      const companyId = getCompanyFilterUuid(req);

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

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const user = (req as any).user;

      let companyIdNumeric: number;

      if (user.role === "superAdmin") {
        if (!data.companyId) {
          res.status(400).json({
            success: false,
            message: "SuperAdmin must specify a company",
          });
          return;
        }
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
        // SECURITY: regular users' companyId is taken from JWT, never from the request body.
        if (!user.companyId) {
          res.status(400).json({
            success: false,
            message: "User must belong to a company to create customers",
          });
          return;
        }
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

      data.companyId = companyIdNumeric;

      if (data.salesPersonId && typeof data.salesPersonId === "string") {
        if (isUUID(data.salesPersonId)) {
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
        } else {
          data.salesPersonId = parseInt(data.salesPersonId, 10);
        }
      }

      if (data.categoryId && typeof data.categoryId === "string") {
        if (isUUID(data.categoryId)) {
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
        } else {
          data.categoryId = parseInt(data.categoryId, 10);
        }
      }

      const inputDTO = new CustomerCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // SECURITY: uuid is generated server-side; never trust client-supplied uuids.
      const dataToCreate: ICustomer = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        name: inputDTO.name,
        code: inputDTO.code,
        dispatchable: inputDTO.dispatchable,
        notes: inputDTO.notes,
        excludeLogoOnLabels: inputDTO.excludeLogoOnLabels,
        requiresQualityCertificate: inputDTO.requiresQualityCertificate,
        supplierCode: inputDTO.supplierCode,
        salesPersonId: inputDTO.salesPersonId,
        categoryId: inputDTO.categoryId,
        active: true,
        legalName: inputDTO.legalName,
        legalCode: inputDTO.legalCode,
        address: inputDTO.address,
        tradeName: inputDTO.tradeName,
        contacts: inputDTO.contacts || [],
        // deliveryLocations/deliveryDays moved to real tables (20260720000008).
      };

      const result = await this._customerDAO.create(dataToCreate);

      this.recordAudit(req, "Alta", result);

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

      const companyId = getCompanyFilterUuid(req);

      // companyId filter doubles as ownership check (404 if not in user's company).
      const existing = await this._customerDAO.getByUuid(uuid, companyId);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
        });
        return;
      }

      if (data.salesPersonId && typeof data.salesPersonId === "string") {
        if (isUUID(data.salesPersonId)) {
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
        } else {
          data.salesPersonId = parseInt(data.salesPersonId, 10);
        }
      }

      if (data.categoryId && typeof data.categoryId === "string") {
        if (isUUID(data.categoryId)) {
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
        } else {
          data.categoryId = parseInt(data.categoryId, 10);
        }
      }

      const inputDTO = new CustomerUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._customerDAO.update(existing.id, inputDTO);

      this.recordAudit(req, "Modificacion", result);

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

      const companyId = getCompanyFilterUuid(req);

      // companyId filter doubles as ownership check (404 if not in user's company).
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
        this.recordAudit(req, "Baja", existing);
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
      // PostgreSQL foreign-key violation: surface a user-friendly 400 instead of leaking the FK error.
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

  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = getCompanyFilterUuid(req);

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
