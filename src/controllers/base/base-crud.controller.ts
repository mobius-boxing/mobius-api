import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { IBaseController } from "../../types.d";
import { IDataPaginator } from "../../database/d.types";
import {
  enforceCompanyFilter,
  getCompanyFilterUuid,
} from "../../utils/companyScope";
import { AuditService } from "../../services/audit.service";

type WithId = { id?: number | null };

export interface ICrudDAO<T> {
  create(item: T): Promise<T>;
  // SECURITY (C2): companyUuid, when provided, scopes the lookup to the caller's company so a
  // record owned by another company is invisible (IDOR protection). undefined = no scoping.
  getByUuid(uuid: string, companyUuid?: string): Promise<(T & WithId) | null>;
  getIdByUuid?(uuid: string, companyUuid?: string): Promise<number | null>;
  update(id: number, item: Partial<T>): Promise<T | null>;
  delete(id: number): Promise<boolean>;
  getAllWithFilters(req: Request): Promise<IDataPaginator<T>>;
}

export interface BaseCrudOptions {
  entityLabel: string;
  enforceCompanyOnList?: boolean;
  // SECURITY (C2): enforce company scoping on single-item ops (getByUuid/update/delete).
  // Defaults to enforceCompanyOnList ?? true. Set false for globally-shared reference entities.
  enforceCompanyOnItem?: boolean;
  fkCatchOnDelete?: boolean;
  fkCatchMessage?: string;
  autoGenerateUuid?: boolean;
  // Audit trail (audit_logs). Defaults to true — nearly every entity gets history
  // (decision 2026-07-18, module 01 audit-log.md). Set false to opt out.
  audit?: boolean;
}

export abstract class BaseCrudController<TEntity> implements IBaseController {
  protected abstract dao: ICrudDAO<TEntity>;
  protected abstract options: BaseCrudOptions;

  private static auditService = new AuditService();

  /** Best-effort audit record — fire-and-forget, never blocks the response. */
  protected recordAudit(
    req: Request,
    operation: "Alta" | "Baja" | "Modificacion",
    entity: Record<string, any> | null,
  ): void {
    if (this.options.audit === false) return;
    void BaseCrudController.auditService.record(
      req,
      this.options.entityLabel,
      operation,
      entity,
    );
  }

  /**
   * On validation failure: set `req.statusCode = 400`, call `next(new Error(msg))`,
   * and return `null`. The base class short-circuits when null is returned.
   */
  protected abstract buildCreateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null>;

  protected abstract buildUpdateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null>;

  /**
   * Return `null` to abort — subclass MUST have already written an error
   * response (e.g., res.status(400).json(...)).
   */
  protected async beforeCreate(
    payload: any,
    _req: Request,
    _res: Response,
  ): Promise<any | null> {
    return payload;
  }

  protected async beforeUpdate(
    payload: any,
    _existingId: number,
    _req: Request,
    _res: Response,
  ): Promise<any | null> {
    return payload;
  }

  /**
   * SECURITY (C2): effective company scoping for single-item ops. Defaults to the list setting,
   * then to true. Globally-shared reference entities opt out via enforceCompanyOnItem: false.
   */
  protected isCompanyScopedOnItem(): boolean {
    return (
      this.options.enforceCompanyOnItem ??
      this.options.enforceCompanyOnList ??
      true
    );
  }

  /**
   * SECURITY (C2): when item scoping is on, derive the caller's company UUID and pass it to the
   * DAO so cross-company records are invisible. SuperAdmins (undefined) keep full access.
   */
  protected itemCompanyUuid(req: Request): string | undefined {
    return this.isCompanyScopedOnItem()
      ? getCompanyFilterUuid(req)
      : undefined;
  }

  protected async getOneByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<TEntity | null> {
    return this.dao.getByUuid(uuid, companyUuid);
  }

  protected sendNotFound(res: Response): void {
    res.status(404).json({
      success: false,
      message: `${this.options.entityLabel} not found`,
    });
  }

  protected async resolveIdByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<number | null> {
    if (typeof this.dao.getIdByUuid === "function") {
      return this.dao.getIdByUuid(uuid, companyUuid);
    }
    const existing = await this.dao.getByUuid(uuid, companyUuid);
    return existing?.id ?? null;
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const enforce = this.options.enforceCompanyOnList ?? true;
      if (enforce) {
        enforceCompanyFilter(req);
      }
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
      const { uuid } = req.params;
      const companyUuid = this.itemCompanyUuid(req);
      const result = await this.getOneByUuid(uuid, companyUuid);

      if (!result) {
        // SECURITY (C2): a non-matching company yields 404, not 403, so existence isn't leaked.
        this.sendNotFound(res);
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
      const dto = await this.buildCreateDTO(req, res, next);
      if (dto === null) return;

      const payload = await this.beforeCreate(dto, req, res);
      if (payload === null) return;

      const autoUuid = this.options.autoGenerateUuid ?? true;
      const dataToCreate = autoUuid
        ? { uuid: uuidv4(), ...payload }
        : payload;

      const result = await this.dao.create(dataToCreate as TEntity);

      this.recordAudit(req, "Alta", result as Record<string, any>);

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

      // SECURITY (C2): scope resolution to the caller's company; a cross-company target → 404.
      const companyUuid = this.itemCompanyUuid(req);
      const existingId = await this.resolveIdByUuid(uuid, companyUuid);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

      const dto = await this.buildUpdateDTO(req, res, next);
      if (dto === null) return;

      const payload = await this.beforeUpdate(dto, existingId, req, res);
      if (payload === null) return;

      const result = await this.dao.update(existingId, payload);

      this.recordAudit(req, "Modificacion", result as Record<string, any> | null);

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

      // SECURITY (C2): scope resolution to the caller's company; a cross-company target → 404.
      const companyUuid = this.itemCompanyUuid(req);
      const existingId = await this.resolveIdByUuid(uuid, companyUuid);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

      // Snapshot before the delete so the Baja audit row keeps the entity's
      // code/description, as Procusto's GenericLogger does.
      const existing =
        this.options.audit === false
          ? null
          : await this.dao.getByUuid(uuid, companyUuid);

      const result = await this.dao.delete(existingId);

      if (result) {
        this.recordAudit(req, "Baja", (existing as Record<string, any>) ?? { uuid });
        res.status(200).json({
          success: true,
          message: `${this.options.entityLabel} deleted successfully`,
        });
      } else {
        res.status(404).json({
          success: false,
          message: `Failed to delete ${this.options.entityLabel.toLowerCase()}`,
        });
      }
    } catch (err: any) {
      if (this.options.fkCatchOnDelete) {
        if (
          err?.code === "23503" ||
          err?.message?.includes?.("foreign key constraint")
        ) {
          const message =
            this.options.fkCatchMessage ??
            `Cannot delete ${this.options.entityLabel.toLowerCase()}: it is referenced by other records. Please remove related data first.`;
          res.status(400).json({
            success: false,
            message,
          });
          return;
        }
      }
      next(err);
    }
  }
}
