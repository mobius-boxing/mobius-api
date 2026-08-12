import { Request, Response, NextFunction } from "express";
import { AuditService } from "../../services/audit.service";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PaperSupplyDAO } from "../../dao/paper-supply/paper-supply.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { PaperTypeDAO } from "../../dao/paper-type/paper-type.dao";
import { FscTypeDAO } from "../../dao/fsc-type/fsc-type.dao";
import { IPaperSupply } from "../../interfaces/paper-supply/paper-supply.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  PaperSupplyCreateInputDTO,
  PaperSupplyUpdateInputDTO,
} from "../../dto/input/paperSupply";
import { getCompanyFilterUuid } from "../../utils/companyScope";

export class PaperSupplyController implements IBaseController {
  private _audit = new AuditService();

  /** Best-effort audit hook (audit_logs) — fire-and-forget. */
  private recordAudit(
    req: any,
    op: "Alta" | "Baja" | "Modificacion",
    entity: any,
  ): void {
    void this._audit.record(req, "Paper supply", op, entity ?? null);
  }

  private _paperSupplyDAO: PaperSupplyDAO = new PaperSupplyDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = getCompanyFilterUuid(req);

      const result: IDataPaginator<IPaperSupply> =
        await this._paperSupplyDAO.getAllWithFilters(req, companyId);
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
            message: "User must belong to a company to create paper supplies",
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
      if (data.paperTypeId && typeof data.paperTypeId === "string") {
        const paperTypeDAO = new PaperTypeDAO();
        const paperTypeNumericId = await paperTypeDAO.getIdByUuid(
          data.paperTypeId,
        );
        if (!paperTypeNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid paper type",
          });
          return;
        }
        data.paperTypeId = paperTypeNumericId;
      }

      if (data.fscTypeId && typeof data.fscTypeId === "string") {
        const fscTypeDAO = new FscTypeDAO();
        const fscTypeNumericId = await fscTypeDAO.getIdByUuid(data.fscTypeId);
        if (!fscTypeNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid FSC type",
          });
          return;
        }
        data.fscTypeId = fscTypeNumericId;
      }

      const inputDTO = new PaperSupplyCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // SECURITY: uuid is generated server-side; never trust client-supplied uuids.
      const dataToCreate: IPaperSupply = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        code: inputDTO.code,
        description: inputDTO.description,
        name: inputDTO.name,
        manufacturerId: inputDTO.manufacturerId,
        supplierId: inputDTO.supplierId,
        // Pre-existing gap fixed: paperTypeId/grammage/price were dropped on create.
        paperTypeId: inputDTO.paperTypeId,
        grammage: inputDTO.grammage,
        price: inputDTO.price,
        color: inputDTO.color,
        fscTypeId: inputDTO.fscTypeId,
        minimumStock: inputDTO.minimumStock,
      };

      const result = await this._paperSupplyDAO.create(dataToCreate);

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
      // mapToInterface strips the numeric id, so resolve it separately.
      const existing = await this._paperSupplyDAO.getByUuid(uuid, companyId);
      const existingId = existing
        ? await this._paperSupplyDAO.getIdByUuid(uuid)
        : null;
      if (!existing || !existingId) {
        res.status(404).json({
          success: false,
          message: "Paper supply not found",
        });
        return;
      }

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
      if (data.paperTypeId && typeof data.paperTypeId === "string") {
        const paperTypeDAO = new PaperTypeDAO();
        const paperTypeNumericId = await paperTypeDAO.getIdByUuid(
          data.paperTypeId,
        );
        if (!paperTypeNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid paper type",
          });
          return;
        }
        data.paperTypeId = paperTypeNumericId;
      }

      if (data.fscTypeId && typeof data.fscTypeId === "string") {
        const fscTypeDAO = new FscTypeDAO();
        const fscTypeNumericId = await fscTypeDAO.getIdByUuid(data.fscTypeId);
        if (!fscTypeNumericId) {
          res.status(400).json({
            success: false,
            message: "Invalid FSC type",
          });
          return;
        }
        data.fscTypeId = fscTypeNumericId;
      }

      const inputDTO = new PaperSupplyUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._paperSupplyDAO.update(existingId, inputDTO);

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
      // mapToInterface strips the numeric id, so resolve it separately.
      const existing = await this._paperSupplyDAO.getByUuid(uuid, companyId);
      const existingId = existing
        ? await this._paperSupplyDAO.getIdByUuid(uuid)
        : null;
      if (!existing || !existingId) {
        res.status(404).json({
          success: false,
          message: "Paper supply not found",
        });
        return;
      }

      const result = await this._paperSupplyDAO.delete(existingId);

      if (result)
        this.recordAudit(req, "Baja", existing ?? { uuid: req.params.uuid });

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
      // PostgreSQL foreign-key violation: surface a user-friendly 400 instead of leaking the FK error.
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

  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = getCompanyFilterUuid(req);

      const result = await this._paperSupplyDAO.getWithDetails(uuid, companyId);

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
