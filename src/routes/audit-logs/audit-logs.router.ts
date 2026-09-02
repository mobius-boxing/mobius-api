import { Router } from "express";
import { AuditLogController } from "../../controllers/audit-log/audit-log.controller";
import {
  apiRateLimiter,
  authenticate,
  requireEntityHistoryAccess,
  requirePermission,
  validatePagination,
  validateUUID,
} from "../../middlewares";

/**
 * `/api/audit-logs` — the read API for the ledger (P3 §P3.1, track T5).
 *
 * **Registration order is load-bearing.** `/entities` and `/export.csv` are
 * literal paths that also match `/:uuid`; registered after it, Express would
 * hand them to the detail route and `validateUUID()` would 400 them. Every
 * literal path therefore comes first, and `/:uuid` is always last.
 *
 * Every route is authenticated. `GET /` is gated by
 * `requirePermission("audit.read", {allowReadOnly:true})` — it was
 * `requireAdmin()` before this track (§0.2-7); nothing in the workspace reads
 * it, and the only behaviour change for an existing caller is that
 * `sortBy=entityName|username` now falls back to `occurredAt desc`.
 *
 * The per-record history is the exception: it is gated by
 * `requireEntityHistoryAccess`, which accepts `audit.read` OR the entity's own
 * code (ruling R-1), so a role that may read an entity may read that record's
 * history without being handed the whole ledger.
 */
export class AuditLogsRouter {
  public router: Router = Router();
  private readonly controller: AuditLogController = new AuditLogController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/entities",
      authenticate,
      requirePermission("audit.read", { allowReadOnly: true }),
      apiRateLimiter,
      this.controller.getEntities.bind(this.controller),
    );

    // Before `/:uuid`: appended after the detail route, `export.csv` would be
    // matched as a uuid and `validateUUID()` would 400 it.
    //
    // `audit.export` without `allowReadOnly`, unlike every other route here:
    // taking the whole ledger off the platform in one file is a separate
    // decision from reading it on screen. No `validatePagination` either: an
    // export is the whole filtered set, not a page — the DAO overrides `page`
    // and `limit` with the 10 000-row cap — and validating a pair of numbers
    // the endpoint then ignores would advertise a pagination it does not have.
    this.router.get(
      "/export.csv",
      authenticate,
      requirePermission("audit.export"),
      apiRateLimiter,
      this.controller.exportCsv.bind(this.controller),
    );

    this.router.get(
      "/history/:entityName/:entityUuid",
      authenticate,
      requireEntityHistoryAccess,
      validatePagination,
      apiRateLimiter,
      this.controller.getHistory.bind(this.controller),
    );

    this.router.get(
      "/",
      authenticate,
      requirePermission("audit.read", { allowReadOnly: true }),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );

    this.router.get(
      "/:uuid",
      authenticate,
      requirePermission("audit.read", { allowReadOnly: true }),
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
  }
}
