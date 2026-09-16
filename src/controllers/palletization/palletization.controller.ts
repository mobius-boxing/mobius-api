import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { PalletizationDAO } from "../../dao/palletization/palletization.dao";
import { PalletTypeDAO } from "../../dao/pallet-type/pallet-type.dao";
import { IPalletization } from "../../interfaces/palletization/palletization.interfaces";
import {
  PalletizationCreateInputDTO,
  PalletizationUpdateInputDTO,
} from "../../dto/input/palletization";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { getCompanyForCreate } from "../../utils/companyScope";
import { companyFilterScope } from "../../utils/daoScope";

export class PalletizationController extends BaseCrudController<IPalletization> {
  protected dao = new PalletizationDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Palletization",
    // DB backstop for the 409 pre-check below (products.palletizationId SET NULL,
    // so this path is unlikely to fire — the pre-check is the real guard, D-22).
    fkCatchOnDelete: true,
    fkCatchMessage: "Cannot delete palletization: products still reference it.",
  };

  private palletTypeDAO = new PalletTypeDAO();

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    let inputDTO: any;
    try {
      inputDTO = new PalletizationCreateInputDTO(req.body).build();
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
      inputDTO = new PalletizationUpdateInputDTO(req.body).build();
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

  /** Resolve palletTypeUuid → palletTypeId; validate file uuids exist. */
  private async resolveRefs(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<Record<string, any> | null> {
    const resolved: Record<string, any> = {};
    const companyScope = companyFilterScope(req);

    if (inputDTO.palletTypeUuid !== undefined) {
      if (!inputDTO.palletTypeUuid) {
        resolved.palletTypeId = null;
      } else {
        const palletTypeId = await this.palletTypeDAO.getIdByUuid(
          inputDTO.palletTypeUuid,
          companyScope,
        );
        if (!palletTypeId) {
          res
            .status(400)
            .json({ success: false, message: "Pallet type not found" });
          return null;
        }
        resolved.palletTypeId = palletTypeId;
      }
    }

    for (const key of ["technicalFileUuid", "imageFileUuid"] as const) {
      if (inputDTO[key]) {
        const fileId = await getIdByUuid(inputDTO[key], "files");
        if (!fileId) {
          res
            .status(400)
            .json({ success: false, message: `File not found (${key})` });
          return null;
        }
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

    const payload: any = { ...inputDTO, ...refs, companyId };
    delete payload.palletTypeUuid;
    return payload;
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const refs = await this.resolveRefs(inputDTO, req, res);
    if (refs === null) return null;

    const payload: any = { ...inputDTO, ...refs };
    delete payload.palletTypeUuid;
    return payload;
  }

  /**
   * D-22: deleting a Palletization referenced by products answers 409 with
   * the count — `products."palletizationId"` is SET NULL, so the FK itself
   * never blocks the delete; this pre-check is the real guard.
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const companyScope = this.itemCompanyScope(req);
      const existingId = await this.resolveIdByUuid(uuid, companyScope);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

      const referencing = await this.dao.countProductsReferencing(existingId);
      if (referencing.count > 0) {
        res.status(409).json({
          success: false,
          message: `Cannot delete palletization: ${referencing.count} product(s) still reference it.`,
          count: referencing.count,
          productCodes: referencing.codes,
        });
        return;
      }
    } catch (err: any) {
      next(err);
      return;
    }
    await super.delete(req, res, next);
  }
}
