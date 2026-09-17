import { Request, Response, NextFunction } from "express";
import { setAuditAction } from "../../database/audit-context";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ProductDAO } from "../../dao/product/product.dao";
import { ModelDAO } from "../../dao/model/model.dao";
import { CoreClient } from "../../services/core-client.service";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { ProductTypeDAO } from "../../dao/product-type/product-type.dao";
import { BoxTypeDAO } from "../../dao/box-type/box-type.dao";
import { IProduct } from "../../interfaces/product/product.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ProductCreateInputDTO,
  ProductUpdateInputDTO,
  ProductCalculateInputDTO,
} from "../../dto/input/product";
import { db } from "../../database/registry";
import {
  ProductCalculator,
  type ICalculableProduct,
} from "../../services/product-calculator/product-calculator.service";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";

/** *Uuid body field → { table it resolves through, numeric column it writes }. */
const REF_TABLES: Record<string, { table: string; idKey: string }> = {
  corrugationUuid: { table: "corrugations", idKey: "corrugationId" },
  productionRouteUuid: {
    table: "production_routes",
    idKey: "productionRouteId",
  },
  palletizationUuid: { table: "palletizations", idKey: "palletizationId" },
  modelUuid: { table: "models", idKey: "modelId" },
  flapTypeUuid: { table: "flap_types", idKey: "flapTypeId" },
  glueTypeUuid: { table: "glue_types", idKey: "glueTypeId" },
  strappingTypeUuid: { table: "strapping_types", idKey: "strappingTypeId" },
  traceTypeUuid: { table: "trace_types", idKey: "traceTypeId" },
  complementUuid: { table: "complements", idKey: "complementId" },
};

/** The 8 cascade fields `boxWeight` recomputes from (I-6 trigger keys, minus corrugationUuid). */
const BOX_WEIGHT_TRIGGER_KEYS = [
  "boxSurface",
  "grammage",
  "corrugationUuid",
] as const;

export class ProductController implements IBaseController {
  private _productDAO: ProductDAO = new ProductDAO();
  private _modelDAO: ModelDAO = new ModelDAO();
  private calculator = new ProductCalculator();

  /**
   * Map-driven FK resolution for the fields that keep their legacy plain-Id
   * naming (D-12: customerId/productTypeId/boxTypeId hold uuids). Mutates
   * `data` in place — the same shape the DTO constructor expects. Returns
   * false when it already responded with a 400. Company-scoped (L-009/I-9,
   * D-30 review fix): another tenant's uuid answers the same "Invalid X" 400
   * a nonexistent one would, never resolving to a foreign-company row.
   */
  private async resolveLegacyRefs(
    data: any,
    companyScope: CompanyScope | undefined,
    res: Response,
  ): Promise<boolean> {
    const resolvers: Array<{
      key: "customerId" | "productTypeId" | "boxTypeId";
      dao: {
        getIdByUuid(
          uuid: string,
          companyId?: CompanyScope,
        ): Promise<number | null>;
      };
      label: string;
    }> = [
      { key: "customerId", dao: new CustomerDAO(), label: "customer" },
      {
        key: "productTypeId",
        dao: new ProductTypeDAO(),
        label: "product type",
      },
      { key: "boxTypeId", dao: new BoxTypeDAO(), label: "box type" },
    ];
    for (const { key, dao, label } of resolvers) {
      // Unselected optional dropdowns submit "" — that's "no value", not a ref;
      // left as-is it reaches the integer FK column and 400s (22P02).
      if (data[key] === "" || data[key] === null) {
        data[key] = null;
        continue;
      }
      if (data[key] && typeof data[key] === "string") {
        const numericId = await dao.getIdByUuid(data[key], companyScope);
        if (!numericId) {
          res.status(400).json({ success: false, message: `Invalid ${label}` });
          return false;
        }
        data[key] = numericId;
      }
    }
    return true;
  }

  /**
   * Resolve the folded-recipe `*Uuid` refs to internal ids (C-9/D-1),
   * company-scoped (L-009/I-9, D-30 review fix — reversed from the original
   * unscoped read: another tenant's uuid must answer the same 404-shaped
   * "Referenced X not found" 400 a nonexistent uuid gets, exactly like
   * `POST /product/calculate`'s corrugation lookup). `corrugationRow` also
   * carries `theoreticalGrammage` for the boxWeight recompute (I-6).
   */
  private async resolveRecipeRefs(
    inputDTO: Record<string, unknown>,
    companyScope: CompanyScope | undefined,
    res: Response,
  ): Promise<{
    refs: Record<string, number | null>;
    corrugationRow: { id: number; theoreticalGrammage: number | null } | null;
  } | null> {
    const refs: Record<string, number | null> = {};
    let corrugationRow: {
      id: number;
      theoreticalGrammage: number | null;
    } | null = null;

    for (const [uuidKey, config] of Object.entries(REF_TABLES)) {
      if (inputDTO[uuidKey] === undefined) continue;
      const value = inputDTO[uuidKey] as string | null;
      if (!value) {
        refs[config.idKey] = null;
        continue;
      }
      if (uuidKey === "corrugationUuid") {
        const query = db("tenant")("corrugations")
          .where("uuid", value)
          .select("id", "theoreticalGrammage");
        applyCompanyScope(query, "corrugations", companyScope);
        const row = await query.first();
        if (!row) {
          res.status(400).json({
            success: false,
            message: "Referenced corrugations not found",
          });
          return null;
        }
        refs[config.idKey] = row.id;
        corrugationRow = {
          id: row.id,
          theoreticalGrammage:
            row.theoreticalGrammage != null
              ? parseFloat(row.theoreticalGrammage)
              : null,
        };
        continue;
      }
      const query = db("tenant")(config.table)
        .where("uuid", value)
        .select("id");
      applyCompanyScope(query, config.table, companyScope);
      const row = await query.first();
      if (!row) {
        res.status(400).json({
          success: false,
          message: `Referenced ${config.table.replace(/_/g, " ")} not found`,
        });
        return null;
      }
      refs[config.idKey] = row.id;
    }
    return { refs, corrugationRow };
  }

  /**
   * I-6: recompute `boxWeight` only when the payload named `boxSurface`,
   * `grammage` or `corrugationUuid`. `undefined` means "leave it untouched".
   */
  private recomputeBoxWeight(args: {
    rawBody: Record<string, unknown>;
    sentBoxSurface: number | undefined;
    sentGrammage: number | undefined;
    existingBoxSurface: number | null | undefined;
    existingGrammage: number | null | undefined;
    sentCorrugation: { theoreticalGrammage: number | null } | null | undefined;
    existingCorrugationTheoreticalGrammage: number | null | undefined;
  }): number | null | undefined {
    const triggered = BOX_WEIGHT_TRIGGER_KEYS.some(
      (key) => args.rawBody[key] !== undefined,
    );
    if (!triggered) return undefined;

    const effectiveSurface =
      args.sentBoxSurface !== undefined
        ? args.sentBoxSurface
        : (args.existingBoxSurface ?? null);
    const effectiveGrammageInput =
      args.sentGrammage !== undefined
        ? args.sentGrammage
        : (args.existingGrammage ?? null);
    // `corrugationUuid` sent (even unchanged) re-reads the corrugation's
    // theoretical grammage; otherwise the existing one carries over.
    const corrugationTheoretical =
      args.sentCorrugation !== undefined
        ? (args.sentCorrugation?.theoreticalGrammage ?? null)
        : (args.existingCorrugationTheoreticalGrammage ?? null);

    const effectiveGrammage = this.calculator.effectiveGrammage(
      effectiveGrammageInput,
      corrugationTheoretical,
    );
    return this.calculator.boxWeight(effectiveSurface, effectiveGrammage);
  }

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
      const result: IDataPaginator<IProduct> =
        await this._productDAO.getAllWithFilters(req);
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

      const companyId = companyFilterScope(req);

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

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const user = req.user;
      if (!user) {
        res
          .status(401)
          .json({ success: false, message: "Authentication required." });
        return;
      }

      let companyIdNumeric: number;

      if (user.role === "superAdmin") {
        if (!data.companyId) {
          res.status(400).json({
            success: false,
            message: "SuperAdmin must specify a company",
          });
          return;
        }
        const numericId =
          typeof data.companyId === "string"
            ? await CoreClient.companyIdByUuid(data.companyId)
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
            message: "User must belong to a company to create products",
          });
          return;
        }
        const numericId = await CoreClient.companyIdByUuid(user.companyId);
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

      // L-009/I-9 (D-30, review fix): every ref this create resolves is
      // scoped to the company the product is being created FOR — the target
      // company for a superAdmin, the caller's own otherwise.
      if (!(await this.resolveLegacyRefs(data, companyIdNumeric, res))) return;

      let inputDTO: ProductCreateInputDTO;
      try {
        inputDTO = new ProductCreateInputDTO(data).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        res.status(400).json({ success: false, message: validation.message });
        return;
      }

      const recipeRefs = await this.resolveRecipeRefs(
        inputDTO as unknown as Record<string, unknown>,
        companyIdNumeric,
        res,
      );
      if (recipeRefs === null) return;
      const { refs, corrugationRow } = recipeRefs;

      const boxWeight = this.recomputeBoxWeight({
        rawBody: data,
        sentBoxSurface: inputDTO.boxSurface,
        sentGrammage: inputDTO.grammage,
        existingBoxSurface: undefined,
        existingGrammage: undefined,
        sentCorrugation:
          data.corrugationUuid !== undefined ? corrugationRow : undefined,
        existingCorrugationTheoreticalGrammage: undefined,
      });

      // D-14: route auto-assign only when corrugationUuid is sent AND no
      // productionRouteUuid was sent — bare fixtures never spawn a route.
      const autoAssignRoute =
        data.corrugationUuid !== undefined &&
        refs.corrugationId != null &&
        data.productionRouteUuid === undefined;

      // SECURITY: uuid is generated server-side; never trust client-supplied uuids.
      const dataToCreate: IProduct = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        code: inputDTO.code!,
        clientCode: inputDTO.clientCode,
        description: inputDTO.description,
        customerId: inputDTO.customerId,
        revision: inputDTO.revision,
        vip: inputDTO.vip,
        productTypeId: inputDTO.productTypeId,
        boxTypeId: inputDTO.boxTypeId,
        technicalSheetFileUuid: inputDTO.technicalSheetFileUuid,
        blueprintFileUuid: inputDTO.blueprintFileUuid,
        sketchFileUuid: inputDTO.sketchFileUuid,
        imageFileUuid: inputDTO.imageFileUuid,
        ...this.recipeFieldsOf(inputDTO),
        ...refs,
        ...(boxWeight !== undefined ? { boxWeight } : {}),
      };

      const result = await this._productDAO.create(dataToCreate, {
        autoAssignRoute,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /** Every recipe key the DTO carries (everything but the base product fields). */
  private recipeFieldsOf(
    inputDTO: ProductCreateInputDTO | ProductUpdateInputDTO,
  ): Record<string, unknown> {
    const BASE_KEYS = new Set([
      "companyId",
      "code",
      "clientCode",
      "description",
      "customerId",
      "revision",
      "vip",
      "productTypeId",
      "boxTypeId",
      "technicalSheetFileUuid",
      "blueprintFileUuid",
      "sketchFileUuid",
      "imageFileUuid",
      ...Object.keys(REF_TABLES),
    ]);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputDTO)) {
      if (BASE_KEYS.has(key) || value === undefined) continue;
      out[key] = value;
    }
    return out;
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const companyId = companyFilterScope(req);

      // companyId scope doubles as ownership check (404 if not in user's company).
      // The id comes from getIdByUuid: mapToInterface strips it (L-005).
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      const existing = existingId
        ? await this._productDAO.getByUuid(uuid, companyId)
        : null;
      if (!existingId || !existing) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      // Clearing a reference the product already has is rejected, not silently
      // dropped (model.md PUT contract).
      if (
        Object.prototype.hasOwnProperty.call(data, "corrugationUuid") &&
        !data.corrugationUuid &&
        existing.corrugation
      ) {
        res.status(400).json({
          success: false,
          message: "corrugationUuid cannot be empty",
        });
        return;
      }
      if (
        Object.prototype.hasOwnProperty.call(data, "productionRouteUuid") &&
        !data.productionRouteUuid &&
        existing.productionRoute
      ) {
        res.status(400).json({
          success: false,
          message: "productionRouteUuid cannot be empty",
        });
        return;
      }

      // L-009/I-9 (D-30, review fix): scoped to the same company the
      // existing-product lookup above already resolved.
      if (!(await this.resolveLegacyRefs(data, companyId, res))) return;

      let inputDTO: ProductUpdateInputDTO;
      try {
        inputDTO = new ProductUpdateInputDTO(data).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        res.status(400).json({ success: false, message: validation.message });
        return;
      }

      const recipeRefs = await this.resolveRecipeRefs(
        inputDTO as unknown as Record<string, unknown>,
        companyId,
        res,
      );
      if (recipeRefs === null) return;
      const { refs, corrugationRow } = recipeRefs;

      const boxWeight = this.recomputeBoxWeight({
        rawBody: data,
        sentBoxSurface: inputDTO.boxSurface,
        sentGrammage: inputDTO.grammage,
        existingBoxSurface: existing.boxSurface,
        existingGrammage: existing.grammage,
        sentCorrugation:
          data.corrugationUuid !== undefined ? corrugationRow : undefined,
        existingCorrugationTheoreticalGrammage:
          existing.corrugation?.theoreticalGrammage,
      });

      const updatePayload: Partial<IProduct> = {
        ...this.recipeFieldsOf(inputDTO),
        ...refs,
        ...(boxWeight !== undefined ? { boxWeight } : {}),
      };
      if (inputDTO.code !== undefined) updatePayload.code = inputDTO.code;
      if (inputDTO.clientCode !== undefined)
        updatePayload.clientCode = inputDTO.clientCode;
      if (inputDTO.description !== undefined)
        updatePayload.description = inputDTO.description;
      if (inputDTO.customerId !== undefined)
        updatePayload.customerId = inputDTO.customerId;
      if (inputDTO.revision !== undefined)
        updatePayload.revision = inputDTO.revision;
      if (inputDTO.vip !== undefined) updatePayload.vip = inputDTO.vip;
      if (inputDTO.productTypeId !== undefined)
        updatePayload.productTypeId = inputDTO.productTypeId;
      if (inputDTO.boxTypeId !== undefined)
        updatePayload.boxTypeId = inputDTO.boxTypeId;
      if (inputDTO.technicalSheetFileUuid !== undefined)
        updatePayload.technicalSheetFileUuid = inputDTO.technicalSheetFileUuid;
      if (inputDTO.blueprintFileUuid !== undefined)
        updatePayload.blueprintFileUuid = inputDTO.blueprintFileUuid;
      if (inputDTO.sketchFileUuid !== undefined)
        updatePayload.sketchFileUuid = inputDTO.sketchFileUuid;
      if (inputDTO.imageFileUuid !== undefined)
        updatePayload.imageFileUuid = inputDTO.imageFileUuid;

      // I-15 carve-out (D-32, review fix): a route-less product that first
      // gets a corrugationUuid on this PUT, with no productionRouteUuid sent,
      // gets the same route auto-assign as create — in the SAME transaction
      // as the UPDATE.
      const autoAssignRoute =
        data.corrugationUuid !== undefined &&
        refs.corrugationId != null &&
        data.productionRouteUuid === undefined &&
        !existing.productionRoute;

      // I-3: one UPDATE products, plus at most one production_routes row when
      // a route-less product first gets a corrugation (I-15 carve-out above).
      const result = await this._productDAO.update(existingId, updatePayload, {
        autoAssignRoute,
        companyId: existing.companyId,
        description:
          (inputDTO.description !== undefined
            ? inputDTO.description
            : existing.description) ||
          (inputDTO.code ?? existing.code),
      });

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

      const companyId = companyFilterScope(req);

      // companyId scope doubles as ownership check (404 if not in user's company).
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
      // PostgreSQL foreign-key violation: surface a user-friendly 400 instead of leaking the FK error.
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

  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = companyFilterScope(req);

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

  /**
   * POST /product/calculate — stateless (I-14): runs `ProductCalculator`
   * against the cascade fields plus the model-driven sheet/flap/score-line
   * cascade (fefco-sheet-calculation) and returns the result without writing
   * anything. `corrugationUuid`/`modelUuid` are company-scoped (I-9/L-009):
   * another tenant's uuid answers 404, never 400. `modelUuid` absent/null
   * keeps today's flute-only behaviour (AC-3).
   */
  public async calculate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      let inputDTO: ProductCalculateInputDTO;
      try {
        inputDTO = new ProductCalculateInputDTO(req.body).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }

      const companyScope = companyFilterScope(req);
      const corrugationQuery = db("tenant")("corrugations")
        .where("uuid", inputDTO.corrugationUuid)
        .select("id", "theoreticalGrammage", "caliper");
      applyCompanyScope(corrugationQuery, "corrugations", companyScope);
      const corrugation = await corrugationQuery.first();
      if (!corrugation) {
        res
          .status(404)
          .json({ success: false, message: "Corrugation not found" });
        return;
      }

      const model = inputDTO.modelUuid
        ? await this._modelDAO.getByUuid(inputDTO.modelUuid, companyScope)
        : null;
      if (inputDTO.modelUuid && !model) {
        res.status(404).json({ success: false, message: "Model not found" });
        return;
      }

      const flute = await db("tenant")("corrugation_layers as cl")
        .join("flute_types as ft", "cl.fluteTypeId", "ft.id")
        .where("cl.corrugationId", corrugation.id)
        .whereNotNull("cl.fluteTypeId")
        .orderBy("cl.position", "asc")
        .select("ft.length", "ft.width", "ft.height")
        .first();

      const adjustments = flute
        ? {
            length: flute.length != null ? parseFloat(flute.length) : null,
            width: flute.width != null ? parseFloat(flute.width) : null,
            height: flute.height != null ? parseFloat(flute.height) : null,
          }
        : null;
      const theoreticalGrammage =
        corrugation.theoreticalGrammage != null
          ? parseFloat(corrugation.theoreticalGrammage)
          : null;
      const caliper =
        corrugation.caliper != null ? parseFloat(corrugation.caliper) : null;

      const values: ICalculableProduct = { ...inputDTO.values };
      const result = this.calculator.applyEdit(
        values,
        inputDTO.field,
        inputDTO.value,
        adjustments,
        theoreticalGrammage,
        model,
        caliper,
      );

      const effectiveGrammage = this.calculator.effectiveGrammage(
        result.grammage,
        theoreticalGrammage,
      );
      // A save always recomputes the weight (the modal sends corrugationUuid),
      // so the preview must too, whichever field was edited (I-16).
      this.calculator.recalculateBoxWeight(result, theoreticalGrammage);

      res.status(200).json({
        success: true,
        data: {
          boxLength: result.boxLength ?? null,
          boxWidth: result.boxWidth ?? null,
          boxHeight: result.boxHeight ?? null,
          externalLength: result.externalLength ?? null,
          externalWidth: result.externalWidth ?? null,
          externalHeight: result.externalHeight ?? null,
          boxSurface: result.boxSurface ?? null,
          boxWeight: result.boxWeight ?? null,
          grammage: result.grammage ?? null,
          effectiveGrammage,
          sheetLength: result.sheetLength ?? null,
          sheetWidth: result.sheetWidth ?? null,
          lowerFlap: result.lowerFlap ?? null,
          upperFlap: result.upperFlap ?? null,
          corrugationScoreLines: result.corrugationScoreLines ?? null,
          printScoreLines: result.printScoreLines ?? null,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * PATCH /product/:uuid/approval — { action: 'approve' | 'cancel' }.
   * Pair semantics per module 06 §04: approve clears cancellation and vice
   * versa; the acting user's email is stored as a denormalized snapshot.
   * `cascade` (D-18): absent/false accepted for one release; `true` → 400 —
   * the recipe-row cascade this used to drive no longer exists (D-1, I-22).
   */
  public async setApproval(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const { action } = req.body;
      if (action !== "approve" && action !== "cancel") {
        res.status(400).json({
          success: false,
          message: "action must be 'approve' or 'cancel'",
        });
        return;
      }
      if (req.body?.cascade === true) {
        res.status(400).json({
          success: false,
          message: "cascade is no longer supported",
        });
        return;
      }

      const companyId = companyFilterScope(req);
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Product not found" });
        return;
      }

      const username = req.user?.email ?? "unknown";

      // A domain verb: the trigger sees an UPDATE of `products` and cannot
      // tell approval from an ordinary edit.
      await setAuditAction("product.approval");

      const result = await this._productDAO.setApproval(
        existingId,
        action,
        username,
      );

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      next(err);
    }
  }
}
