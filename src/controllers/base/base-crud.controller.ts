import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { IBaseController } from "../../types.d";
import { IDataPaginator } from "../../database/d.types";
import { getCompanyForCreate, getCompanyScope } from "../../utils/companyScope";
import { CoreClient } from "../../services/core-client.service";
import {
  companyFilterScope,
  UNRESOLVED_COMPANY,
  type CompanyScope,
} from "../../utils/daoScope";

type WithId = { id?: number | null };

export interface ICrudDAO<T> {
  create(item: T): Promise<T>;
  // SECURITY (C2): companyScope, when provided, scopes the lookup to the caller's company so a
  // record owned by another company is invisible (IDOR protection). undefined = no scoping.
  getByUuid(
    uuid: string,
    companyScope?: CompanyScope,
  ): Promise<(T & WithId) | null>;
  getIdByUuid?(
    uuid: string,
    companyScope?: CompanyScope,
  ): Promise<number | null>;
  update(id: number, item: Partial<T>): Promise<T | null>;
  delete(id: number): Promise<boolean>;
  getAllWithFilters(req: Request): Promise<IDataPaginator<T>>;
}

export interface BaseCrudOptions {
  entityLabel: string;
  // SECURITY (C2): enforce company scoping on single-item ops (getByUuid/update/delete).
  // Defaults to true. Set false for globally-shared reference entities.
  // List scoping is NOT an option: parseQueryParams derives the company filter
  // from the caller's token for every list, always.
  enforceCompanyOnItem?: boolean;
  fkCatchOnDelete?: boolean;
  fkCatchMessage?: string;
  autoGenerateUuid?: boolean;
  // Inject the caller's numeric companyId into create payloads that lack one
  // (default true). 17 subclasses never resolved it, so creates hit NOT NULL
  // violations or silently inserted NULL (rows invisible to scoped lists).
  // Entities without a companyId column simply ignore the injected field.
  injectCompany?: boolean;
}

export abstract class BaseCrudController<TEntity> implements IBaseController {
  protected abstract dao: ICrudDAO<TEntity>;
  protected abstract options: BaseCrudOptions;

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
    return this.options.enforceCompanyOnItem ?? true;
  }

  /**
   * SECURITY (C2): when item scoping is on, derive the caller's company scope and pass it to the
   * DAO so cross-company records are invisible. SuperAdmins (undefined) keep full access.
   */
  protected itemCompanyScope(req: Request): CompanyScope | undefined {
    return this.isCompanyScopedOnItem() ? companyFilterScope(req) : undefined;
  }

  /**
   * SECURITY (L-009): the scope for resolving a client-supplied reference (a
   * type, class or supplier uuid in a payload). It is the list filter's scope,
   * or else the company a superAdmin operates as (`body.companyId`), so a write
   * for company X can never pick up a row of Y. A named company that did not
   * resolve matches nothing; `undefined` only for a superAdmin who names no
   * company at all, which stays unscoped until T7.
   */
  protected referenceScope(req: Request): CompanyScope | undefined {
    const filterScope = companyFilterScope(req);
    if (filterScope !== undefined) return filterScope;
    if (!getCompanyScope(req).companyUuid) return undefined;
    return req.companyId ?? UNRESOLVED_COMPANY;
  }

  protected async getOneByUuid(
    uuid: string,
    companyScope?: CompanyScope,
  ): Promise<TEntity | null> {
    return this.dao.getByUuid(uuid, companyScope);
  }

  protected sendNotFound(res: Response): void {
    res.status(404).json({
      success: false,
      message: `${this.options.entityLabel} not found`,
    });
  }

  protected async resolveIdByUuid(
    uuid: string,
    companyScope?: CompanyScope,
  ): Promise<number | null> {
    if (typeof this.dao.getIdByUuid === "function") {
      return this.dao.getIdByUuid(uuid, companyScope);
    }
    const existing = await this.dao.getByUuid(uuid, companyScope);
    return existing?.id ?? null;
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
      const { uuid } = req.params;
      const companyScope = this.itemCompanyScope(req);
      const result = await this.getOneByUuid(uuid, companyScope);

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

      // Company injection: non-superAdmins always get their JWT company; a
      // superAdmin's body-supplied companyId (uuid) is resolved when present,
      // otherwise left alone (global-row creation stays possible for them).
      if (
        this.options.injectCompany !== false &&
        (payload as any).companyId === undefined
      ) {
        const company = getCompanyForCreate(req);
        if (company.success) {
          const companyId = await CoreClient.companyIdByUuid(
            company.companyUuid,
          );
          if (companyId) (payload as any).companyId = companyId;
        } else if ((req as any).user?.role !== "superAdmin") {
          res.status(400).json({ success: false, message: company.message });
          return;
        }
      } else if (
        this.options.injectCompany !== false &&
        typeof (payload as any).companyId === "string"
      ) {
        // A uuid slipped through a DTO — resolve it to the numeric id.
        const companyId = await CoreClient.companyIdByUuid(
          (payload as any).companyId,
        );
        if (!companyId) {
          res.status(400).json({ success: false, message: "Invalid company" });
          return;
        }
        (payload as any).companyId = companyId;
      }

      const autoUuid = this.options.autoGenerateUuid ?? true;
      const dataToCreate = autoUuid ? { uuid: uuidv4(), ...payload } : payload;

      const result = await this.dao.create(dataToCreate as TEntity);

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
      const companyScope = this.itemCompanyScope(req);
      const existingId = await this.resolveIdByUuid(uuid, companyScope);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

      const dto = await this.buildUpdateDTO(req, res, next);
      if (dto === null) return;

      const payload = await this.beforeUpdate(dto, existingId, req, res);
      if (payload === null) return;

      const result = await this.dao.update(existingId, payload);

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
      const companyScope = this.itemCompanyScope(req);
      const existingId = await this.resolveIdByUuid(uuid, companyScope);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

      // No pre-delete read: the `Baja` row is written by the database trigger,
      // which has OLD. `entityLabel` survives — it is the user-facing message
      // below and the 404 text, not an audit field.
      const result = await this.dao.delete(existingId);

      if (result) {
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
