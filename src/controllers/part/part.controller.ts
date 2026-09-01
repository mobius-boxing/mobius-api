import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PartDAO } from "../../dao/part/part.dao";
import { setAuditAction } from "../../database/audit-context";
import {
  PartCreateInputDTO,
  PartUpdateInputDTO,
  PartCascadeInputDTO,
} from "../../dto/input/part";
import {
  APPROVAL_MACHINES,
  ApprovalMachine,
} from "../../interfaces/part/part.interfaces";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import {
  getCompanyFilterUuid,
  getCompanyForCreate,
} from "../../utils/companyScope";

const REF_TABLES: Record<string, string> = {
  corrugationUuid: "corrugations",
  productionRouteUuid: "production_routes",
  palletizationUuid: "palletizations",
  modelUuid: "models",
  flapTypeUuid: "flap_types",
  glueTypeUuid: "glue_types",
  strappingTypeUuid: "strapping_types",
  traceTypeUuid: "trace_types",
  complementUuid: "complements",
};

const REF_ID_KEYS: Record<string, string> = {
  corrugationUuid: "corrugationId",
  productionRouteUuid: "productionRouteId",
  palletizationUuid: "palletizationId",
  modelUuid: "modelId",
  flapTypeUuid: "flapTypeId",
  glueTypeUuid: "glueTypeId",
  strappingTypeUuid: "strappingTypeId",
  traceTypeUuid: "traceTypeId",
  complementUuid: "complementId",
};

/**
 * Parts (module 07) — the product-definition core.
 * Q-V3 = Mirror: approval never locks editing; approvals are snapshots.
 */
export class PartController {
  private dao = new PartDAO();

  /** Res-free ref resolution; returns an error message instead of writing the response. */
  private async resolveRefsCore(
    inputDTO: any,
  ): Promise<{ refs: Record<string, number | null> } | { error: string }> {
    const refs: Record<string, number | null> = {};
    for (const [uuidKey, table] of Object.entries(REF_TABLES)) {
      if (inputDTO[uuidKey] === undefined) continue;
      if (!inputDTO[uuidKey]) {
        refs[REF_ID_KEYS[uuidKey]] = null;
        continue;
      }
      const id = await getIdByUuid(inputDTO[uuidKey], table);
      if (!id) {
        return { error: `Referenced ${table.replace(/_/g, " ")} not found` };
      }
      refs[REF_ID_KEYS[uuidKey]] = id;
    }
    return { refs };
  }

  private async resolveRefs(
    inputDTO: any,
    res: Response,
  ): Promise<Record<string, number | null> | null> {
    const outcome = await this.resolveRefsCore(inputDTO);
    if ("error" in outcome) {
      res.status(400).json({ success: false, message: outcome.error });
      return null;
    }
    return outcome.refs;
  }

  /**
   * Res-free create core, shared by POST /parts and the product `initialPart`
   * atomic-create path (module 06 ProductoSimpleForm semantics).
   */
  public async createPartFromInput(
    body: any,
    companyId: number,
    productId: number,
    userEmail: string | null,
  ): Promise<
    { ok: true; part: any } | { ok: false; status: number; message: string }
  > {
    let inputDTO: any;
    try {
      inputDTO = new PartCreateInputDTO(body).build();
    } catch (e: any) {
      return { ok: false, status: 400, message: e.message };
    }

    const outcome = await this.resolveRefsCore(inputDTO);
    if ("error" in outcome) {
      return { ok: false, status: 400, message: outcome.error };
    }

    const payload: any = { ...inputDTO, ...outcome.refs, productId, companyId };
    for (const key of Object.keys(REF_TABLES)) delete payload[key];
    delete payload.productUuid;
    // The code is derived server-side ({producto}/{n} MAX+1) — never client-set.
    delete payload.code;
    payload.uuid = uuidv4();
    payload.createdByUsername = userEmail;

    try {
      const created = await this.dao.create(payload);
      return { ok: true, part: created };
    } catch (err: any) {
      if (err?.code === "23505") {
        return {
          ok: false,
          status: 400,
          message: "A part with this code and revision already exists.",
        };
      }
      throw err;
    }
  }

  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /** Nested list: GET /product/:productUuid/parts */
  public async getAllForProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // productUuid comes from the ROUTE, not the query string. Assigning it
      // onto req.query (as this did) is discarded by Express 5's re-parsing
      // getter, so the filter never reached the DAO and this list returned
      // every part in the company instead of the product's own.
      const result = await this.dao.getAllWithFilters(req, {
        productUuid: req.params.productUuid as string,
      });
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const part = await this.dao.getByUuid(req.params.uuid, getCompanyFilterUuid(req));
      if (!part) {
        res.status(404).json({ success: false, message: "Part not found" });
        return;
      }
      res.status(200).json({ success: true, data: part });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = { ...req.body };
      // Nested create: POST /product/:productUuid/parts
      if ((req.params as any).productUuid) body.productUuid = (req.params as any).productUuid;

      const company = getCompanyForCreate(req);
      if (!company.success) {
        res.status(400).json({ success: false, message: company.message });
        return;
      }
      const companyId = await getIdByUuid(company.companyUuid, "companies");
      if (!companyId) {
        res.status(400).json({ success: false, message: "Company not found" });
        return;
      }

      if (!body.productUuid) {
        res.status(400).json({ success: false, message: "productUuid is required" });
        return;
      }
      const productId = await getIdByUuid(body.productUuid, "products");
      if (!productId) {
        res.status(404).json({ success: false, message: "Product not found" });
        return;
      }

      const outcome = await this.createPartFromInput(
        body,
        companyId,
        productId,
        req.user?.email ?? null,
      );
      if (!outcome.ok) {
        res.status(outcome.status).json({ success: false, message: outcome.message });
        return;
      }

      res.status(201).json({ success: true, data: outcome.part });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const existingId = await this.dao.getIdByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!existingId) {
        res.status(404).json({ success: false, message: "Part not found" });
        return;
      }

      let inputDTO: any;
      try {
        inputDTO = new PartUpdateInputDTO(req.body).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }

      const refs = await this.resolveRefs(inputDTO, res);
      if (refs === null) return;

      const payload: any = { ...inputDTO, ...refs };
      for (const key of Object.keys(REF_TABLES)) delete payload[key];
      delete payload.productUuid;
      delete payload.code; // derived — immutable via update

      const updated = await this.dao.update(existingId, payload);
      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const existing = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!existing || !existing.id) {
        res.status(404).json({ success: false, message: "Part not found" });
        return;
      }
      const deleted = await this.dao.delete(existing.id);
      if (deleted) {
        res.status(200).json({ success: true, message: "Part deleted successfully" });
      } else {
        res.status(404).json({ success: false, message: "Failed to delete part" });
      }
    } catch (err: any) {
      if (err?.code === "23503") {
        res.status(400).json({
          success: false,
          message: "Cannot delete part: it is referenced by other records.",
        });
        return;
      }
      next(err);
    }
  }

  /** PATCH /parts/:uuid/approval/:machine  { action: 'approve' | 'cancel' } */
  public async setApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const machine = req.params.machine as ApprovalMachine;
      const { action } = req.body;
      if (!(APPROVAL_MACHINES as readonly string[]).includes(machine)) {
        res.status(400).json({
          success: false,
          message: `machine must be one of: ${APPROVAL_MACHINES.join(", ")}`,
        });
        return;
      }
      if (action !== "approve" && action !== "cancel") {
        res.status(400).json({ success: false, message: "action must be approve or cancel" });
        return;
      }
      const existingId = await this.dao.getIdByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!existingId) {
        res.status(404).json({ success: false, message: "Part not found" });
        return;
      }
      const username = req.user?.email ?? "unknown";
      // A domain verb: the trigger sees an UPDATE of `parts` either way.
      await setAuditAction("part.approval");
      const updated = await this.dao.setApproval(existingId, machine, action, username);
      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      next(err);
    }
  }

  /** POST /parts/bulk-approve | /parts/bulk-unapprove  { uuids: string[] } */
  public bulk(action: "approve" | "unapprove") {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { uuids } = req.body;
        if (!Array.isArray(uuids) || !uuids.length) {
          res.status(400).json({ success: false, message: "uuids must be a non-empty array" });
          return;
        }
        const companyUuid = getCompanyFilterUuid(req);
        const ids: number[] = [];
        for (const uuid of uuids) {
          const id = await this.dao.getIdByUuid(uuid, companyUuid);
          if (id) ids.push(id);
        }
        const username = req.user?.email ?? "unknown";
        // One action for the whole batch: every row it writes shares this
        // request's `txId`, so the ledger can group the bulk back together.
        await setAuditAction(`part.bulk.${action}`);
        const count =
          action === "approve"
            ? await this.dao.bulkApprove(ids, username)
            : await this.dao.bulkUnapprove(ids, username);
        res.status(200).json({ success: true, data: { updated: count } });
      } catch (err: any) {
        next(err);
      }
    };
  }

  /** PATCH /parts/:uuid/cascade  { field, value } */
  public async cascade(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let inputDTO: PartCascadeInputDTO;
      try {
        inputDTO = new PartCascadeInputDTO(req.body).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }
      const existingId = await this.dao.getIdByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!existingId) {
        res.status(404).json({ success: false, message: "Part not found" });
        return;
      }
      const updated = await this.dao.cascade(
        existingId,
        inputDTO.field as any,
        inputDTO.value,
      );
      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      next(err);
    }
  }
}
