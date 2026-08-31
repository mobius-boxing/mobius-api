import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { db } from "../../database/registry";
import {
  ProductionRouteDAO,
  SUPPLY_TABLES,
} from "../../dao/production-route/production-route.dao";
import { MachineTypeDAO } from "../../dao/machine-type/machine-type.dao";
import { MachineDAO } from "../../dao/machine/machine.dao";
import {
  IRouteStage,
  StageSupplyType,
} from "../../interfaces/production-route/production-route.interfaces";
import { validateRoute } from "../../services/route-validator.service";
import { AuditService } from "../../services/audit.service";
import {
  ProductionRouteCreateInputDTO,
  ProductionRouteUpdateInputDTO,
  IStageInput,
} from "../../dto/input/production-route";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import {
  getCompanyFilterUuid,
  getCompanyForCreate,
} from "../../utils/companyScope";

/**
 * Production routes (module 12). Custom controller: nested-tree resolution,
 * two-tier validation (criticals block, warnings returned), Clonar /
 * CopiarEtapas, single-default invariant, delete guard on part references.
 */
export class ProductionRouteController {
  private dao = new ProductionRouteDAO();
  private machineTypeDAO = new MachineTypeDAO();
  private machineDAO = new MachineDAO();
  private audit = new AuditService();

  private recordAudit(
    req: any,
    op: "Alta" | "Baja" | "Modificacion",
    entity: any,
  ): void {
    void this.audit.record(req, "Production route", op, entity ?? null);
  }

  /** Resolve stage-tree UUIDs → numeric ids. Writes the 400 and returns null on any miss. */
  private async resolveStages(
    stages: IStageInput[] | undefined,
    req: Request,
    res: Response,
  ): Promise<IRouteStage[] | null | undefined> {
    if (stages === undefined) return undefined;
    const knex = db("erp");
    const companyUuid = getCompanyFilterUuid(req);
    const resolved: IRouteStage[] = [];

    for (const [index, stage] of stages.entries()) {
      const label = `stage ${index + 1}`;
      let machineTypeId: number | null = null;
      if (stage.machineTypeUuid) {
        machineTypeId = await this.machineTypeDAO.getIdByUuid(
          stage.machineTypeUuid,
          companyUuid,
        );
        if (!machineTypeId) {
          res.status(400).json({
            success: false,
            message: `${label}: machine type not found`,
          });
          return null;
        }
      }

      const machines = [];
      for (const m of stage.machines ?? []) {
        const machineId = await this.machineDAO.getIdByUuid(
          m.machineUuid,
          companyUuid,
        );
        if (!machineId) {
          res
            .status(400)
            .json({ success: false, message: `${label}: machine not found` });
          return null;
        }
        machines.push({ machineId, isPrimary: m.isPrimary ?? true });
      }

      const supplies = [];
      for (const s of stage.supplies ?? []) {
        const table = SUPPLY_TABLES[s.supplyType as StageSupplyType];
        const row = await knex(table)
          .where("uuid", s.supplyUuid)
          .select("id")
          .first();
        if (!row) {
          res.status(400).json({
            success: false,
            message: `${label}: ${s.supplyType} supply not found`,
          });
          return null;
        }
        supplies.push({
          // Row identity for the DAO's diff-and-upsert (audit P1b). Dropping it
          // here silently degrades the upsert back to delete-and-reinsert.
          uuid: s.uuid,
          direction: s.direction as "input" | "output",
          supplyType: s.supplyType as StageSupplyType,
          supplyId: row.id,
          quantity: s.quantity ?? null,
          quantityType: s.quantityType ?? null,
          repetitionsWidth: s.repetitionsWidth ?? 1.0,
          repetitionsLength: s.repetitionsLength ?? 1.0,
          allowsSimilar: s.allowsSimilar ?? false,
          notes: s.notes ?? null,
        });
      }

      resolved.push({
        uuid: stage.uuid,
        number: stage.number ?? index + 1,
        description: stage.description ?? null,
        isCorrugation: stage.isCorrugation ?? false,
        setupTimeMinutes: stage.setupTimeMinutes ?? 0,
        machineTypeId,
        machines,
        supplies,
      });
    }
    // Renumber 1..N by array order (Procusto semantics) before validation.
    resolved
      .sort((a, b) => a.number - b.number)
      .forEach((stage, i) => (stage.number = i + 1));
    return resolved;
  }

  /** Run V1–V13; criticals → 422 with the problem list. Returns warnings. */
  private validateOrReject(
    route: { name?: string; isGlobal?: boolean; stages: IRouteStage[] },
    res: Response,
  ) {
    const validation = validateRoute(route);
    if (validation.critical.length) {
      res.status(422).json({
        success: false,
        message: "Route validation failed",
        problems: validation.critical,
        warnings: validation.warnings,
      });
      return null;
    }
    return validation.warnings;
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await this.dao.getAllWithFilters(req);
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
      const route = await this.dao.getByUuid(
        req.params.uuid,
        getCompanyFilterUuid(req),
      );
      if (!route) {
        res
          .status(404)
          .json({ success: false, message: "Production route not found" });
        return;
      }
      res.status(200).json({ success: true, data: route });
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
      const inputDTO = new ProductionRouteCreateInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
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

      const stages = await this.resolveStages(inputDTO.stages, req, res);
      if (stages === null) return;

      const warnings = this.validateOrReject(
        {
          name: inputDTO.name,
          isGlobal: inputDTO.isGlobal ?? false,
          stages: stages ?? [],
        },
        res,
      );
      if (warnings === null) return;

      const route = await this.dao.create({
        companyId,
        name: inputDTO.name,
        isGlobal: inputDTO.isGlobal ?? false,
        active: inputDTO.active ?? true,
        isDefault: inputDTO.isDefault ?? false,
        stages: stages ?? [],
      });
      this.recordAudit(req, "Alta", route);
      res.status(201).json({ success: true, data: route, warnings });
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
      const companyUuid = getCompanyFilterUuid(req);
      const existing = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!existing || !existing.id) {
        res
          .status(404)
          .json({ success: false, message: "Production route not found" });
        return;
      }

      const inputDTO = new ProductionRouteUpdateInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const stages = await this.resolveStages(inputDTO.stages, req, res);
      if (stages === null) return;

      const effective = {
        name: inputDTO.name ?? existing.name,
        isGlobal: inputDTO.isGlobal ?? existing.isGlobal,
        stages: stages ?? existing.stages ?? [],
      };
      const warnings = this.validateOrReject(effective, res);
      if (warnings === null) return;

      const { stages: _rawStages, ...routeFields } = inputDTO;
      const updated = await this.dao.update(existing.id, {
        ...routeFields,
        ...(stages !== undefined ? { stages } : {}),
      });
      this.recordAudit(req, "Modificacion", updated);
      res.status(200).json({ success: true, data: updated, warnings });
    } catch (err: any) {
      next(err);
    }
  }

  public async clone(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const source = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!source || !source.id) {
        res
          .status(404)
          .json({ success: false, message: "Production route not found" });
        return;
      }
      let name = (req.body?.name as string) || source.name;
      if (await this.dao.nameExists(source.companyId!, name)) {
        name = `${name} (copia)`;
      }
      const cloned = await this.dao.clone(source.id, name);
      this.recordAudit(req, "Alta", cloned);
      res.status(201).json({ success: true, data: cloned });
    } catch (err: any) {
      next(err);
    }
  }

  public async copyStages(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const target = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!target || !target.id) {
        res
          .status(404)
          .json({ success: false, message: "Production route not found" });
        return;
      }
      const { sourceRouteUuid } = req.body ?? {};
      if (!sourceRouteUuid) {
        res
          .status(400)
          .json({ success: false, message: "sourceRouteUuid is required" });
        return;
      }
      const source = await this.dao.getByUuid(sourceRouteUuid, companyUuid);
      if (!source || !source.id) {
        res
          .status(404)
          .json({ success: false, message: "Source route not found" });
        return;
      }
      await this.dao.copyStages(target.id, source.id);
      const updated = await this.dao.getByUuid(req.params.uuid, companyUuid);
      this.recordAudit(req, "Modificacion", updated);
      res.status(200).json({ success: true, data: updated });
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
      const companyUuid = getCompanyFilterUuid(req);
      const existing = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!existing || !existing.id) {
        res
          .status(404)
          .json({ success: false, message: "Production route not found" });
        return;
      }
      // Spec 04: Procusto never hard-deletes a route parts still use.
      if (await this.dao.isReferencedByParts(existing.id)) {
        res.status(400).json({
          success: false,
          message:
            "Cannot delete route: parts still reference it. Reassign them first.",
        });
        return;
      }
      await this.dao.delete(existing.id);
      this.recordAudit(req, "Baja", existing);
      res.status(200).json({
        success: true,
        message: "Production route deleted successfully",
      });
    } catch (err: any) {
      next(err);
    }
  }
}
