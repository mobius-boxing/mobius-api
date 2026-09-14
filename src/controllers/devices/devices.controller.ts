import { Request, Response, NextFunction } from "express";
import { UserDeviceDAO } from "../../dao/user-device/user-device.dao";
import { IDataPaginator } from "../../database/d.types";
import {
  IUserDevice,
  IUserDeviceView,
} from "../../interfaces/user-device/user-device.interfaces";
import { setAuditAction } from "../../database/audit-context";
import { companyFilterScope, type CompanyScope } from "../../utils/daoScope";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { parseQueryParams } from "../../utils/queryBuilder";

const DEVICE_NOT_FOUND = {
  success: false,
  message: "Device not found.",
  code: "DEVICE_NOT_FOUND",
} as const;

const ALREADY_APPROVED = {
  success: false,
  message: "Device is already approved.",
  code: "INVALID_DEVICE_TRANSITION",
} as const;

const ALREADY_REVOKED = {
  success: false,
  message: "Device is already revoked.",
  code: "INVALID_DEVICE_TRANSITION",
} as const;

/** The row plus what the two write verbs need from the request. */
type LoadedDevice = {
  device: IUserDevice;
  /** Both read off the row, never guessed from a stripped mapper (L-005). */
  deviceId: number;
  deviceUuid: string;
  companyScope: CompanyScope | undefined;
};

/**
 * `/api/devices` — the admin queue: list, approve, revoke.
 *
 * Hand-rolled rather than on `BaseCrudController` (house rule: non-CRUD verbs),
 * like `audit-log.controller.ts:330`: there is no create, no update and no
 * delete here — rows are minted by login and die with their user (D-6).
 *
 * Neither verb takes a body, and neither ever reads `approvedBy`/`revokedBy`
 * from the request: both come from the caller's token (I-9).
 */
export class DevicesController {
  private dao = new UserDeviceDAO();

  /**
   * `req` is handed over untouched so every documented param (`status`,
   * `search`, `page`/`limit`, `sortBy`/`sortOrder`, a superAdmin's `companyId`)
   * reaches the shared builder (L-007); the DAO resolves the company scope
   * itself with `companyFilterScope` (db-per-company T1/AC-7, `UserDAO`/
   * `RoleDAO` precedent) and applies it as a local predicate on
   * `users.companyId` — no join to `companies` (I-8).
   *
   * The one case that scope cannot express on its own is a non-superAdmin
   * whose token carries no company at all: `companyFilterScope` then answers
   * `undefined`, the same value it uses for "a superAdmin selected nothing",
   * which would leave the query unscoped and hand one tenant's approver every
   * other tenant's devices (I-8, L-009). Such a caller gets an empty page
   * instead, and the DAO is never asked.
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (this.isUnscopedNonSuperAdmin(req, companyFilterScope(req))) {
        res.status(200).json(this.emptyPage(req));
        return;
      }

      res.status(200).json(await this.dao.getAllWithFilters(req));
    } catch (err) {
      next(err);
    }
  }

  public async approve(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const loaded = await this.load(req, res);
      if (!loaded) return;

      // `revoked` is an allowed source (D-149): an admin who revoked the wrong
      // device re-approves it without making the employee log in again. The
      // DAO's update clears `revokedAt`/`revokedBy`, so I-4 holds.
      if (loaded.device.status === "approved") {
        res.status(409).json(ALREADY_APPROVED);
        return;
      }

      await setAuditAction("user_device.approve");
      await this.dao.approve(loaded.deviceId, await this.actorId(req));

      res.status(200).json({ success: true, data: await this.view(loaded) });
    } catch (err) {
      next(err);
    }
  }

  public async revoke(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const loaded = await this.load(req, res);
      if (!loaded) return;

      if (loaded.device.status === "revoked") {
        res.status(409).json(ALREADY_REVOKED);
        return;
      }

      await setAuditAction("user_device.revoke");
      await this.dao.revoke(loaded.deviceId, await this.actorId(req));

      res.status(200).json({ success: true, data: await this.view(loaded) });
    } catch (err) {
      next(err);
    }
  }

  /**
   * The device the caller named, or `null` once the 404 has been written —
   * callers read it like the reference-resolution helpers in
   * `production-order.controller.ts`.
   *
   * Unknown and cross-tenant uuids are indistinguishable here: the scope is part
   * of the query, so a foreign row reads as absent and answers the same body
   * (D-18). This runs before the code is compared, so a guess against another
   * tenant's device cannot even count as an attempt.
   */
  private async load(
    req: Request,
    res: Response,
  ): Promise<LoadedDevice | null> {
    const companyScope = companyFilterScope(req);
    if (this.isUnscopedNonSuperAdmin(req, companyScope)) {
      res.status(404).json(DEVICE_NOT_FOUND);
      return null;
    }

    const device = await this.dao.getByUuid(req.params.uuid, companyScope);
    if (!device) {
      res.status(404).json(DEVICE_NOT_FOUND);
      return null;
    }

    const { id: deviceId, uuid: deviceUuid } = device;
    if (deviceId === undefined || deviceUuid === undefined) {
      throw new Error(
        "UserDeviceDAO.getByUuid returned a device without its id or uuid",
      );
    }

    return { device, deviceId, deviceUuid, companyScope };
  }

  /**
   * `companyFilterScope` answers `undefined` both for "a superAdmin named no
   * company" (full cross-company view, intended) and for "a non-superAdmin
   * whose token carries no company" (must not become an unscoped read, I-8).
   * The two cases share a return value but never a caller role, so this is the
   * one place that tells them apart.
   */
  private isUnscopedNonSuperAdmin(
    req: Request,
    companyScope: CompanyScope | undefined,
  ): boolean {
    return req.user?.role !== "superAdmin" && companyScope === undefined;
  }

  /** An unscoped caller's page, answered without a query. */
  private emptyPage(req: Request): IDataPaginator<IUserDeviceView> {
    const { page, limit } = parseQueryParams(req);

    return {
      success: true,
      data: [],
      page,
      limit,
      count: 0,
      totalCount: 0,
      totalPages: 0,
    };
  }

  /**
   * The wire shape after the write, re-read rather than mapped: the response
   * carries `approvedBy`/`revokedBy` as user objects, which only the view's
   * joins produce. The read runs on the same ambient transaction as the write,
   * so it sees it — and in the same company scope, so it cannot answer with a
   * row the caller could not have named.
   */
  private async view(loaded: LoadedDevice): Promise<IUserDeviceView> {
    const view = await this.dao.getViewByUuid(
      loaded.deviceUuid,
      loaded.companyScope,
    );
    if (!view) {
      throw new Error(
        "the device just written is no longer readable in the caller's scope",
      );
    }

    return view;
  }

  /** `users.id` of the caller — the one source for `approvedBy`/`revokedBy` (I-9). */
  private async actorId(req: Request): Promise<number> {
    const actorId = await getIdByUuid(req.user?.userId ?? null, "users");
    if (actorId === null) {
      throw new Error(
        "the authenticated caller has no users row; cannot attribute the device transition",
      );
    }

    return actorId;
  }
}
