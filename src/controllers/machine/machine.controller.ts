import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { MachineDAO } from "../../dao/machine/machine.dao";
import { MachineTypeDAO } from "../../dao/machine-type/machine-type.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { IMachine } from "../../interfaces/machine/machine.interfaces";
import {
  MachineCreateInputDTO,
  MachineUpdateInputDTO,
} from "../../dto/input/machine";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { getCompanyForCreate } from "../../utils/companyScope";
import { companyFilterScope } from "../../utils/daoScope";

export class MachineController extends BaseCrudController<IMachine> {
  protected dao = new MachineDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Machine",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete machine: production route stages still reference it.",
  };

  private machineTypeDAO = new MachineTypeDAO();
  private supplierDAO = new SupplierDAO();

  /**
   * I-5: `supplierId` may be non-null only on a machine whose type isSupplier.
   * Checked on the EFFECTIVE pair, so changing only the type of a mapped
   * machine is refused as well.
   */
  private async checkSupplierAllowed(
    refs: Record<string, number | null>,
    existingId: number | null,
    res: Response,
  ): Promise<boolean> {
    const stored = existingId
      ? await this.dao.getTypeAndSupplier(existingId)
      : null;
    const supplierId =
      refs.supplierId !== undefined
        ? refs.supplierId
        : (stored?.supplierId ?? null);
    if (supplierId === null) return true;
    const machineTypeId =
      refs.machineTypeId !== undefined
        ? refs.machineTypeId
        : (stored?.machineTypeId ?? null);
    if (machineTypeId && (await this.dao.typeIsSupplier(machineTypeId))) {
      return true;
    }
    res.status(400).json({
      success: false,
      code: "SUPPLIER_NOT_ALLOWED",
      message: "A supplier can only be mapped to a machine of a supplier type.",
    });
    return false;
  }

  protected async buildCreateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    let inputDTO: any;
    try {
      inputDTO = new MachineCreateInputDTO(req.body).build();
    } catch (e: any) {
      // DTO build() throws are validation failures (CLAUDE.md validation rule).
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    let inputDTO: any;
    try {
      inputDTO = new MachineUpdateInputDTO(req.body).build();
    } catch (e: any) {
      // DTO build() throws are validation failures (CLAUDE.md validation rule).
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  private async resolveRefs(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<Record<string, number | null> | null> {
    const companyScope = companyFilterScope(req);
    const resolved: Record<string, number | null> = {};

    if (inputDTO.machineTypeUuid !== undefined) {
      const machineTypeId = await this.machineTypeDAO.getIdByUuid(
        inputDTO.machineTypeUuid,
        companyScope,
      );
      if (!machineTypeId) {
        res
          .status(400)
          .json({ success: false, message: "Machine type not found" });
        return null;
      }
      resolved.machineTypeId = machineTypeId;
    }
    if (inputDTO.supplierUuid !== undefined) {
      const supplierId = inputDTO.supplierUuid
        ? await this.supplierDAO.getIdByUuid(
            inputDTO.supplierUuid,
            companyScope,
          )
        : null;
      if (inputDTO.supplierUuid && !supplierId) {
        res.status(400).json({ success: false, message: "Supplier not found" });
        return null;
      }
      resolved.supplierId = supplierId;
    }
    for (const [uuidKey, idKey, table] of [
      ["sourceWarehouseUuid", "sourceWarehouseId", "warehouses"],
      ["destinationWarehouseUuid", "destinationWarehouseId", "warehouses"],
    ] as const) {
      if (inputDTO[uuidKey] !== undefined) {
        const id = inputDTO[uuidKey]
          ? await getIdByUuid(inputDTO[uuidKey], table)
          : null;
        if (inputDTO[uuidKey] && !id) {
          res
            .status(400)
            .json({ success: false, message: "Warehouse not found" });
          return null;
        }
        resolved[idKey] = id;
      }
    }
    return resolved;
  }

  protected async beforeCreate(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const company = getCompanyForCreate(req);
    if (!company.success) {
      res.status(400).json({ success: false, message: company.message });
      return null;
    }
    const companyId = await getIdByUuid(company.companyUuid, "companies");
    if (!companyId) {
      res.status(400).json({ success: false, message: "Company not found" });
      return null;
    }
    const refs = await this.resolveRefs(inputDTO, req, res);
    if (refs === null) return null;
    if (!(await this.checkSupplierAllowed(refs, null, res))) return null;

    const payload: any = { ...inputDTO, companyId, ...refs };
    delete payload.supplierUuid;
    delete payload.machineTypeUuid;
    delete payload.sourceWarehouseUuid;
    delete payload.destinationWarehouseUuid;
    return payload;
  }

  protected async beforeUpdate(
    inputDTO: any,
    existingId: number,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const refs = await this.resolveRefs(inputDTO, req, res);
    if (refs === null) return null;
    if (!(await this.checkSupplierAllowed(refs, existingId, res))) return null;

    const payload: any = { ...inputDTO, ...refs };
    delete payload.supplierUuid;
    delete payload.machineTypeUuid;
    delete payload.sourceWarehouseUuid;
    delete payload.destinationWarehouseUuid;
    return payload;
  }
}
