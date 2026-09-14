import { Request, Response, NextFunction } from "express";
import { CompanyDAO } from "../../dao/company/company.dao";
import { DbServerDAO } from "../../dao/db-server/db-server.dao";
import { TenantDatabaseDAO } from "../../dao/tenant-database/tenant-database.dao";
import {
  IDbServer,
  ITenantDatabase,
} from "../../interfaces/tenant/tenant.interfaces";
import { tenantStats } from "../../database/tenant-pools";
import {
  beginProvisioning,
  runProvisioningSteps,
} from "../../services/tenant-provisioning.service";
import { TenantSuspendInputDTO } from "../../dto/tenant/tenant-suspend.dto";
import { TenantProvisionInputDTO } from "../../dto/tenant/tenant-provision.dto";

/** Model's exact 404 body — shared with `tenant-context.middleware.ts` by value, not by import (that file is outside this track). */
const COMPANY_NOT_FOUND_BODY = {
  success: false,
  code: "COMPANY_NOT_FOUND",
  message: "The selected company no longer exists.",
} as const;

const TENANT_DB_NOT_REGISTERED_BODY = {
  success: false,
  code: "TENANT_DB_NOT_REGISTERED",
  message: "This company has no tenant database registered.",
} as const;

/**
 * `GET/POST .../tenant-database[/provision|/suspend|/resume]` (model, T10
 * D-46: superAdmin only, wired by the router). One controller for the whole
 * `tenant-database` sub-resource, mirroring `CompanyModulesController`'s
 * hand-rolled shape (non-CRUD verbs, no `IBaseController`).
 */
export class TenantDatabaseController {
  private _companyDAO = new CompanyDAO();
  private _tenantDatabaseDAO = new TenantDatabaseDAO();
  private _dbServerDAO = new DbServerDAO();

  /** Any row worth reporting on `GET` — live OR still building (model: POST provision's 202 body is "the same body as GET"). */
  private async findReportableRow(
    companyId: number,
  ): Promise<ITenantDatabase | null> {
    const live = await this._tenantDatabaseDAO.getLiveByCompanyId(companyId);
    if (live) return live;
    return this._tenantDatabaseDAO.getBuildingByCompanyId(companyId);
  }

  private toResponse(row: ITenantDatabase, server: IDbServer) {
    return {
      uuid: row.uuid,
      status: row.status,
      placement: server.kind,
      server: { uuid: server.uuid, name: server.name },
      databaseName: row.databaseName,
      schemaVersion: row.schemaVersion,
      migrationState: row.migrationState,
      lastMigrationAt: row.lastMigrationAt,
      lastMigrationError: row.lastMigrationError,
      pool: tenantStats(row.id),
      provisionedAt: row.provisionedAt,
      suspendedAt: row.suspendedAt,
      suspendReason: row.suspendReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async getByCompany(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json(COMPANY_NOT_FOUND_BODY);
        return;
      }

      const row = await this.findReportableRow(companyId);
      if (!row) {
        res.status(404).json(TENANT_DB_NOT_REGISTERED_BODY);
        return;
      }

      const server = await this._dbServerDAO.getById(row.serverId);
      if (!server) {
        next(
          new Error(
            `db_servers #${row.serverId} missing for tenant_databases #${row.id}`,
          ),
        );
        return;
      }

      res.status(200).json({ success: true, data: this.toResponse(row, server) });
    } catch (err: any) {
      next(err);
    }
  }

  public async provision(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json(COMPANY_NOT_FOUND_BODY);
        return;
      }

      let dto: TenantProvisionInputDTO;
      try {
        dto = new TenantProvisionInputDTO(req.body ?? {}).build();
      } catch (dtoErr) {
        next(dtoErr);
        return;
      }

      const prepared = await beginProvisioning(companyId, {
        serverUuid: dto.serverUuid,
      });
      if (!prepared.ok) {
        res.status(409).json({
          success: false,
          code: prepared.code,
          message: prepared.reason,
        });
        return;
      }

      // D-19: fire-and-forget — `runProvisioningSteps` always ends in a
      // `transition()` call (active or failed), so there is nothing here that
      // needs to be awaited for the response, and nothing that can escape as
      // an unhandled rejection.
      if (prepared.needsRun) {
        void runProvisioningSteps(
          prepared.row,
          prepared.server,
          prepared.companyUuid,
        ).catch((err) => {
          console.error(
            `[tenant-database] background provisioning failed for company #${companyId}:`,
            err,
          );
        });
      }

      res
        .status(202)
        .json({ success: true, data: this.toResponse(prepared.row, prepared.server) });
    } catch (err: any) {
      next(err);
    }
  }

  private async transitionSuspendResume(
    req: Request,
    res: Response,
    next: NextFunction,
    from: "active" | "suspended",
    to: "active" | "suspended",
    patch: { suspendReason?: string } = {},
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const companyId = await this._companyDAO.getIdByUuid(uuid);
      if (!companyId) {
        res.status(404).json(COMPANY_NOT_FOUND_BODY);
        return;
      }

      const row = await this._tenantDatabaseDAO.getLiveByCompanyId(companyId);
      if (!row) {
        res.status(404).json(TENANT_DB_NOT_REGISTERED_BODY);
        return;
      }

      if (row.status !== from) {
        res.status(409).json({
          success: false,
          code: "TENANT_STATUS_CONFLICT",
          message: `tenant_databases is "${row.status}", not "${from}".`,
          data: { status: row.status },
        });
        return;
      }

      const updated = await this._tenantDatabaseDAO.transition(
        row.id,
        from,
        to,
        patch,
      );
      if (updated === 0) {
        // A race since the read above — the CAS itself found a different status.
        const current = await this._tenantDatabaseDAO.getById(row.id);
        res.status(409).json({
          success: false,
          code: "TENANT_STATUS_CONFLICT",
          message: `tenant_databases is "${current?.status ?? "unknown"}", not "${from}".`,
          data: { status: current?.status ?? "unknown" },
        });
        return;
      }

      const finalRow = (await this._tenantDatabaseDAO.getById(
        row.id,
      )) as ITenantDatabase;
      const server = await this._dbServerDAO.getById(finalRow.serverId);
      if (!server) {
        next(
          new Error(
            `db_servers #${finalRow.serverId} missing for tenant_databases #${finalRow.id}`,
          ),
        );
        return;
      }

      res.status(200).json({ success: true, data: this.toResponse(finalRow, server) });
    } catch (err: any) {
      next(err);
    }
  }

  public async suspend(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    let dto: TenantSuspendInputDTO;
    try {
      dto = new TenantSuspendInputDTO(req.body).build();
    } catch (dtoErr) {
      next(dtoErr);
      return;
    }
    await this.transitionSuspendResume(req, res, next, "active", "suspended", {
      suspendReason: dto.reason,
    });
  }

  public async resume(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    await this.transitionSuspendResume(req, res, next, "suspended", "active");
  }
}
