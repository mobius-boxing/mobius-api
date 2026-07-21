import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { PartDAO } from "../../dao/part/part.dao";
import { AuditService } from "../../services/audit.service";
import {
  PartCreateInputDTO,
  PartUpdateInputDTO,
  PartCascadeInputDTO,
} from "../../dto/input/part";
import { ApprovalMachine } from "../../interfaces/part/part.interfaces";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import {
  enforceCompanyFilter,
  getCompanyFilterUuid,
  getCompanyForCreate,
} from "../../utils/companyScope";

const MACHINES: ApprovalMachine[] = ["dimensions", "technical", "sketch", "part"];

const REF_TABLES: Record<string, string> = {
  corrugationUuid: "corrugations",
  productionRouteUuid: "production_routes",
  palletizationUuid: "palletizations",
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
  private audit = new AuditService();

  private recordAudit(req: any, op: "Alta" | "Baja" | "Modificacion", entity: any): void {
    void this.audit.record(req, "Part", op, entity ?? null);
  }

  private async resolveRefs(
    inputDTO: any,
    res: Response,
  ): Promise<Record<string, number | null> | null> {
    const resolved: Record<string, number | null> = {};
    for (const [uuidKey, table] of Object.entries(REF_TABLES)) {
      if (inputDTO[uuidKey] === undefined) continue;
      if (!inputDTO[uuidKey]) {
        resolved[REF_ID_KEYS[uuidKey]] = null;
        continue;
      }
      const id = await getIdByUuid(inputDTO[uuidKey], table);
      if (!id) {
        res.status(400).json({
          success: false,
          message: `Referenced ${table.replace(/_/g, " ")} not found`,
        });
        return null;
      }
      resolved[REF_ID_KEYS[uuidKey]] = id;
    }
    return resolved;
  }

  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result = await this.dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /** Nested list: GET /product/:productUuid/parts */
  public async getAllForProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      enforceCompanyFilter(req);
      (req.query as any).productUuid = req.params.productUuid;
      const result = await this.dao.getAllWithFilters(req);
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

      let inputDTO: any;
      try {
        inputDTO = new PartCreateInputDTO(body).build();
      } catch (e: any) {
        res.status(400).json({ success: false, message: e.message });
        return;
      }

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

      const productId = await getIdByUuid(inputDTO.productUuid, "products");
      if (!productId) {
        res.status(404).json({ success: false, message: "Product not found" });
        return;
      }

      const refs = await this.resolveRefs(inputDTO, res);
      if (refs === null) return;

      const payload: any = { ...inputDTO, ...refs, productId, companyId };
      for (const key of Object.keys(REF_TABLES)) delete payload[key];
      delete payload.productUuid;
      // The code is derived server-side ({producto}/{n} MAX+1) — never client-set.
      delete payload.code;
      payload.uuid = uuidv4();
      payload.createdByUsername = (req as any).user?.email ?? null;

      const created = await this.dao.create(payload);
      this.recordAudit(req, "Alta", created);
      res.status(201).json({ success: true, data: created });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(400).json({
          success: false,
          message: "A part with this code and revision already exists.",
        });
        return;
      }
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
      this.recordAudit(req, "Modificacion", updated);
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
        this.recordAudit(req, "Baja", existing);
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
      if (!MACHINES.includes(machine)) {
        res.status(400).json({
          success: false,
          message: `machine must be one of: ${MACHINES.join(", ")}`,
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
      const username = (req as any).user?.email ?? "unknown";
      const updated = await this.dao.setApproval(existingId, machine, action, username);
      this.recordAudit(req, "Modificacion", updated);
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
        const username = (req as any).user?.email ?? "unknown";
        const count =
          action === "approve"
            ? await this.dao.bulkApprove(ids, username)
            : await this.dao.bulkUnapprove(ids, username);
        this.recordAudit(req, "Modificacion", { bulk: action, count });
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
