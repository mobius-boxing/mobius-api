import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ModelDAO } from "../../dao/model/model.dao";
import { FlapTypeDAO } from "../../dao/flap-type/flap-type.dao";
import { ComplementDAO } from "../../dao/complement/complement.dao";
import { IModel } from "../../interfaces/model/model.interfaces";
import {
  ModelCreateInputDTO,
  ModelUpdateInputDTO,
} from "../../dto/input/model";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import {
  getCompanyForCreate,
  getCompanyFilterUuid,
} from "../../utils/companyScope";
import {
  validate,
  FORMULA_PARAMETERS,
  FORMULA_FUNCTIONS,
  FORMULA_OPERATORS,
} from "../../services/formula-engine";

export class ModelController extends BaseCrudController<IModel> {
  protected dao = new ModelDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Model",
    // DB backstop for the 409 pre-check below (parts.modelId RESTRICT).
    fkCatchOnDelete: true,
    fkCatchMessage: "Cannot delete model: parts still reference it.",
  };

  private flapTypeDAO = new FlapTypeDAO();
  private complementDAO = new ComplementDAO();

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    let inputDTO: any;
    try {
      inputDTO = new ModelCreateInputDTO(req.body).build();
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
      inputDTO = new ModelUpdateInputDTO(req.body).build();
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

  /**
   * Resolve flapTypeUuid/complementUuid → numeric ids through the
   * COMPANY-SCOPED lookup DAOs (L-009: a foreign-company uuid is rejected,
   * never silently stored), and check imageFileUuid exists.
   */
  private async resolveRefs(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<Record<string, any> | null> {
    const resolved: Record<string, any> = {};
    const companyUuid = getCompanyFilterUuid(req);

    if (inputDTO.flapTypeUuid !== undefined) {
      if (!inputDTO.flapTypeUuid) {
        resolved.flapTypeId = null;
      } else {
        const flapType = await this.flapTypeDAO.getByUuid(
          inputDTO.flapTypeUuid,
          companyUuid,
        );
        if (!flapType?.id) {
          res
            .status(400)
            .json({ success: false, message: "Flap type not found" });
          return null;
        }
        resolved.flapTypeId = flapType.id;
      }
    }

    if (inputDTO.complementUuid !== undefined) {
      if (!inputDTO.complementUuid) {
        resolved.complementId = null;
      } else {
        const complement = await this.complementDAO.getByUuid(
          inputDTO.complementUuid,
          companyUuid,
        );
        if (!complement?.id) {
          res
            .status(400)
            .json({ success: false, message: "Complement not found" });
          return null;
        }
        resolved.complementId = complement.id;
      }
    }

    if (inputDTO.imageFileUuid) {
      const fileId = await getIdByUuid(inputDTO.imageFileUuid, "files");
      if (!fileId) {
        res
          .status(400)
          .json({ success: false, message: "File not found (imageFileUuid)" });
        return null;
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
    delete payload.flapTypeUuid;
    delete payload.complementUuid;
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
    delete payload.flapTypeUuid;
    delete payload.complementUuid;
    return payload;
  }

  /**
   * SECURITY (L-009): scope the list explicitly. The base class relies on
   * enforceCompanyFilter() mutating req.query, but Express 5 discards those
   * writes, so the query-mutation path no longer scopes anything. The
   * caller's company uuid is handed straight to the DAO instead
   * (superAdmin without ?companyId= ⇒ undefined ⇒ sees all).
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await this.dao.getAllWithFilters(
        req,
        getCompanyFilterUuid(req),
      );
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /** D-8: deleting a Modelo referenced by Parts answers 409 with the count. */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const companyUuid = this.itemCompanyUuid(req);
      const existingId = await this.resolveIdByUuid(uuid, companyUuid);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

      const referencing = await this.dao.countPartsReferencing(existingId);
      if (referencing.count > 0) {
        res.status(409).json({
          success: false,
          message: `Cannot delete model: ${referencing.count} part(s) still reference it.`,
          count: referencing.count,
          partCodes: referencing.codes,
        });
        return;
      }
    } catch (err: any) {
      next(err);
      return;
    }
    await super.delete(req, res, next);
  }

  /**
   * POST /models/test-formula — `Formula.Testear` parity: validates against
   * the fixture and surfaces the runtime example value. Non-finite results
   * serialise as `exampleValue: null` + `exampleValueText` ("Infinity", …)
   * since JSON has no Infinity.
   */
  public async testFormula(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { formula } = req.body ?? {};
      if (
        formula !== undefined &&
        formula !== null &&
        typeof formula !== "string"
      ) {
        res
          .status(400)
          .json({ success: false, message: "formula must be a string" });
        return;
      }
      const result = validate(formula);
      if (!result.ok) {
        res.status(200).json({
          success: true,
          data: { ok: false, error: result.error },
        });
        return;
      }
      // Empty formula evaluates to 0 (`Formula.Evaluar` guard clause).
      const value = result.value ?? 0;
      res.status(200).json({
        success: true,
        data: {
          ok: true,
          exampleValue: Number.isFinite(value) ? value : null,
          exampleValueText: String(value),
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /models/formula-reference — the "Campos y funciones" popup source.
   * Reads the engine's exported catalogues (single source of truth; AC-29).
   */
  public async formulaReference(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      res.status(200).json({
        success: true,
        data: {
          parameters: FORMULA_PARAMETERS,
          functions: FORMULA_FUNCTIONS,
          operators: FORMULA_OPERATORS,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }
}
