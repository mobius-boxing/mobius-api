import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  DbServerDAO,
  DbServerDefaultPlacementExistsError,
  DbServerNameTakenError,
  type IDbServerListItem,
} from "../../dao/db-server/db-server.dao";
import { IDbServer } from "../../interfaces/tenant/tenant.interfaces";
import { DbServerCreateInputDTO } from "../../dto/tenant/db-server-create.dto";
import { DbServerStatusPatchInputDTO } from "../../dto/tenant/db-server-status-patch.dto";

/**
 * `GET/POST /api/db-servers`, `PATCH /api/db-servers/:uuid` (model, T10;
 * D-46 superAdmin only, wired by the router). Non-CRUD shape (no `PUT`/
 * `DELETE` in this feature — model), so this does not implement
 * `IBaseController`, mirroring `CompanyModulesController`.
 */
export class DbServersController {
  private _dbServerDAO = new DbServerDAO();

  /** `adminCredentialRef`/`adminCredentialCiphertext` never leave the API (model I-6). */
  private toListItem(row: IDbServerListItem) {
    return {
      uuid: row.uuid,
      name: row.name,
      kind: row.kind,
      host: row.host,
      port: row.port,
      sslMode: row.sslMode,
      status: row.status,
      isDefaultPlacement: row.isDefaultPlacement,
      connectionBudget: row.connectionBudget,
      provisionable: row.provisionable,
      tenantCount: row.tenantCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toItem(row: IDbServer) {
    return this.toListItem({
      ...row,
      tenantCount: 0,
      provisionable: row.adminUser !== null,
    });
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await this._dbServerDAO.getAllWithFilters(req);
      res.status(200).json({ ...result, data: result.data.map((row) => this.toListItem(row)) });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    let dto: DbServerCreateInputDTO;
    try {
      dto = new DbServerCreateInputDTO(req.body).build();
    } catch (dtoErr) {
      next(dtoErr);
      return;
    }

    try {
      const created = await this._dbServerDAO.create({
        uuid: uuidv4(),
        name: dto.name,
        kind: dto.kind,
        host: dto.host,
        port: dto.port,
        sslMode: dto.sslMode,
        adminUser: dto.adminUser ?? null,
        adminCredentialRef: dto.adminCredentialRef ?? null,
        connectionBudget: dto.connectionBudget,
        isDefaultPlacement: dto.isDefaultPlacement,
      });
      res.status(201).json({ success: true, data: this.toItem(created) });
    } catch (err) {
      if (err instanceof DbServerNameTakenError) {
        res.status(409).json({
          success: false,
          code: "NAME_TAKEN",
          message: `A db_servers row named "${dto.name}" already exists.`,
        });
        return;
      }
      if (err instanceof DbServerDefaultPlacementExistsError) {
        res.status(409).json({
          success: false,
          code: "DEFAULT_PLACEMENT_EXISTS",
          message: "A db_servers row is already the default placement.",
        });
        return;
      }
      next(err);
    }
  }

  public async updateStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      let dto: DbServerStatusPatchInputDTO;
      try {
        dto = new DbServerStatusPatchInputDTO(req.body).build();
      } catch (dtoErr) {
        next(dtoErr);
        return;
      }

      const existing = await this._dbServerDAO.getByUuid(uuid);
      if (!existing) {
        res.status(404).json({ success: false, message: "Server not found" });
        return;
      }

      const updated = await this._dbServerDAO.updateStatus(uuid, dto.status);
      res.status(200).json({ success: true, data: this.toItem(updated as IDbServer) });
    } catch (err: any) {
      next(err);
    }
  }
}
