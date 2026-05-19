import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { IBaseController } from "../../types.d";
import { IDataPaginator } from "../../database/d.types";
import { enforceCompanyFilter } from "../../utils/companyScope";

type WithId = { id?: number | null };

export interface ICrudDAO<T> {
  create(item: T): Promise<T>;
  getByUuid(uuid: string): Promise<(T & WithId) | null>;
  getIdByUuid?(uuid: string): Promise<number | null>;
  update(id: number, item: Partial<T>): Promise<T | null>;
  delete(id: number): Promise<boolean>;
  getAllWithFilters(req: Request): Promise<IDataPaginator<T>>;
}

export interface BaseCrudOptions {
  entityLabel: string;
  enforceCompanyOnList?: boolean;
  fkCatchOnDelete?: boolean;
  fkCatchMessage?: string;
  autoGenerateUuid?: boolean;
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

  protected async getOneByUuid(uuid: string): Promise<TEntity | null> {
    return this.dao.getByUuid(uuid);
  }

  protected sendNotFound(res: Response): void {
    res.status(404).json({
      success: false,
      message: `${this.options.entityLabel} not found`,
    });
  }

  protected async resolveIdByUuid(uuid: string): Promise<number | null> {
    if (typeof this.dao.getIdByUuid === "function") {
      return this.dao.getIdByUuid(uuid);
    }
    const existing = await this.dao.getByUuid(uuid);
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
      const dto = await this.buildCreateDTO(req, res, next);
      if (dto === null) return;

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
