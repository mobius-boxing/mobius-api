import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { IBaseController } from "../../types.d";
import { IDataPaginator } from "../../database/d.types";
import { enforceCompanyFilter } from "../../utils/companyScope";

/**
 * Minimal DAO contract that every CRUD-standard controller in this codebase
 * already satisfies. Intentionally narrower than IBaseDAO<T> — we only depend
 * on what the migrated controllers actually use.
 *
 * Note: this base class deliberately does NOT support `getByUuid(uuid, companyUuid?)`
 * (the company-scoped DAO variant used by Customer/CustomerCategory/Product).
 * Those controllers are intentionally left un-migrated.
 */
/**
 * Entity shape constraint — every entity has a numeric `id`. Used only to type
 * the `getByUuid → existing.id` fallback path.
 */
type WithId = { id?: number | null };

export interface ICrudDAO<T> {
  create(item: T): Promise<T>;
  getByUuid(uuid: string): Promise<(T & WithId) | null>;
  /**
   * Optional fast-path: resolve UUID → numeric ID without fetching the whole row.
   * If absent, the base class falls back to `getByUuid(uuid)?.id`.
   *
   * Some DAOs (corrugation-class, box-type, warehouse, ...) ship this method;
   * others (complement, flap-type, glue-type, strapping-type, trace-type,
   * flute-type, paper-class) do not. The original controllers in those cases
   * used `getByUuid → existing.id`, so the fallback is byte-equivalent.
   */
  getIdByUuid?(uuid: string): Promise<number | null>;
  update(id: number, item: Partial<T>): Promise<T | null>;
  delete(id: number): Promise<boolean>;
  getAllWithFilters(req: Request): Promise<IDataPaginator<T>>;
}

export interface BaseCrudOptions {
  /** Human label used in 404/200 messages: "Box type", "Paper sheet", etc. */
  entityLabel: string;
  /**
   * Apply enforceCompanyFilter() on getAll. Default: true.
   * No-op on tables without companyId column — safe to leave on.
   */
  enforceCompanyOnList?: boolean;
  /**
   * Catch err.code === "23503" on delete and return the standard 400 response.
   * Default: false. Set true only for entities whose original controller had this catch.
   */
  fkCatchOnDelete?: boolean;
  /**
   * Override the FK-catch 400 message. Only honored when fkCatchOnDelete is true.
   * Default: "Cannot delete <label>: it is referenced by other records. Please remove related data first."
   * (label is options.entityLabel.toLowerCase())
   *
   * Currently only tooling-type uses a bespoke message ("referenced by toolings").
   */
  fkCatchMessage?: string;
  /**
   * If true, generate uuidv4() and merge into payload right before dao.create().
   * Default: true. Matches every existing controller.
   */
  autoGenerateUuid?: boolean;
}

/**
 * BaseCrudController centralizes the universal CRUD pattern shared by ~25 of
 * the 34 controllers in this API.
 *
 * Responsibilities handled here (do NOT re-implement in subclasses):
 *   - try/catch + next(err) wiring on every route handler
 *   - 404 wrapping when getIdByUuid returns null
 *   - 200/201 success-response shape
 *   - uuidv4() generation prior to create
 *   - enforceCompanyFilter() on getAll (toggle via options.enforceCompanyOnList)
 *   - FK constraint catch on delete (toggle via options.fkCatchOnDelete)
 *
 * Subclass extension points (override only what's needed):
 *   - buildCreateDTO / buildUpdateDTO (REQUIRED — DTOs are entity-specific)
 *   - beforeCreate / beforeUpdate (optional — FK resolution, company-scope injection)
 *   - getOneByUuid (optional — stock controllers override to call dao.getWithDetails)
 *
 * NOT provided in v1 (add only when first real caller appears):
 *   - afterCreate / afterUpdate / beforeDelete / afterDelete
 */
export abstract class BaseCrudController<TEntity> implements IBaseController {
  protected abstract dao: ICrudDAO<TEntity>;
  protected abstract options: BaseCrudOptions;

  // ---------- HOOKS ----------

  /**
   * Build + validate the create-input DTO. MUST be implemented by subclasses
   * (DTOs are entity-specific).
   *
   * Contract:
   *   - Returns the validated DTO ready to merge into the create payload.
   *   - On validation failure: set `req.statusCode = 400`, call `next(new Error(msg))`,
   *     and return `null`. The base class will short-circuit when null is returned.
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
   * Called after DTO validation, before dao.create(). Override to resolve
   * foreign-key UUIDs to numeric IDs, attach companyId, etc.
   *
   * Contract:
   *   - Return the (possibly mutated) payload to proceed.
   *   - Return `null` to abort — subclass MUST have already written an error
   *     response (e.g., res.status(400).json(...)).
   *
   * Default: no-op pass-through.
   */
  protected async beforeCreate(
    payload: any,
    _req: Request,
    _res: Response,
  ): Promise<any | null> {
    return payload;
  }

  /**
   * Called after DTO validation + existence check, before dao.update().
   * Same contract as beforeCreate. `existingId` is the resolved numeric ID
   * of the entity being updated.
   */
  protected async beforeUpdate(
    payload: any,
    _existingId: number,
    _req: Request,
    _res: Response,
  ): Promise<any | null> {
    return payload;
  }

  /**
   * Fetch the entity for GET /:uuid. Default calls dao.getByUuid(uuid).
   *
   * Stock controllers override this to call dao.getWithDetails(uuid), which
   * returns a richer payload (joined supplier/manufacturer/etc.). A naive
   * migration would lose that data — keep this hook.
   */
  protected async getOneByUuid(uuid: string): Promise<TEntity | null> {
    return this.dao.getByUuid(uuid);
  }

  // ---------- HELPERS ----------

  /**
   * Send the standard 404 "<Label> not found" response. Centralized so that
   * label changes flow from options.entityLabel.
   */
  protected sendNotFound(res: Response): void {
    res.status(404).json({
      success: false,
      message: `${this.options.entityLabel} not found`,
    });
  }

  /**
   * Resolve UUID → numeric ID, preferring dao.getIdByUuid() when available and
   * falling back to dao.getByUuid()?.id. Identical to the two patterns observed
   * in the legacy controllers (id-resolve-direct vs. id-resolve-existing).
   */
  protected async resolveIdByUuid(uuid: string): Promise<number | null> {
    if (typeof this.dao.getIdByUuid === "function") {
      return this.dao.getIdByUuid(uuid);
    }
    const existing = await this.dao.getByUuid(uuid);
    return existing?.id ?? null;
  }

  // ---------- ROUTE HANDLERS ----------

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
      const result = await this.getOneByUuid(uuid);

      if (!result) {
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
      // Subclass validates DTO and writes its own 400 via next() on failure.
      const dto = await this.buildCreateDTO(req, res, next);
      if (dto === null) return;

      // Subclass may inject companyId, resolve FK UUIDs, etc.
      // If it writes its own 400 response, it returns null to short-circuit.
      const payload = await this.beforeCreate(dto, req, res);
      if (payload === null) return;

      const autoUuid = this.options.autoGenerateUuid ?? true;
      const dataToCreate = autoUuid
        ? { uuid: uuidv4(), ...payload }
        : payload;

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

      const existingId = await this.resolveIdByUuid(uuid);
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

      const existingId = await this.resolveIdByUuid(uuid);
      if (!existingId) {
        this.sendNotFound(res);
        return;
      }

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
