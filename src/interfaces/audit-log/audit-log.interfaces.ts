export type AuditOperation = "Alta" | "Baja" | "Modificacion";

/**
 * Where a row came from. `api|job|seed|script` are what P1's request context
 * can emit; `migration|sql` are the trigger's own — `sql` is the default when
 * `mobius.audit` is unset (a psql session, a detached upload route, a job that
 * has not been wrapped yet), so a null `username` always has an explanation.
 */
export type AuditSourceValue =
  | "api"
  | "job"
  | "seed"
  | "migration"
  | "script"
  | "sql";

/**
 * One row of the v2 ledger, as the trigger writes it (P2 / §P2.2).
 *
 * Every field is optional except the two the trigger always knows, because
 * nothing in the application constructs this type any more — it exists to type
 * the READ side. Notably:
 * - `before`/`after` are whole rows on `Alta`/`Baja` and **only the changed
 *   keys** on `Modificacion` (V-1); `changedKeys` names them, sorted.
 * - `entityId`/`entityUuid` are null for the tables that have no such column
 *   (`paper_class_papers`, `role_permissions` have neither; three more have no
 *   `uuid`): those rows are reachable only through `rootUuid` / `txId`.
 * - `rootUuid` is null for a cascade-deleted child — the parent row is already
 *   gone when the child's AFTER DELETE trigger runs — but the parent's own
 *   `Baja` shares its `txId`.
 * - `companyId` and `userId` are values, not foreign keys (ruling R-B).
 */
export interface IAuditLog {
  id?: number;
  uuid?: string;
  companyId?: number | null;
  entityName: string;
  entityId?: number | null;
  entityUuid?: string | null;
  entityCode?: string | null;
  entityDescription?: string | null;
  entityLegacyId?: number | null;
  operation: AuditOperation;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changedKeys?: string[] | null;
  rootEntity?: string | null;
  rootUuid?: string | null;
  action?: string | null;
  source?: AuditSourceValue;
  txId?: string | null;
  requestId?: string | null;
  username?: string | null;
  userId?: number | null;
  actorRole?: string | null;
  actorCompanyId?: number | null;
  context?: Record<string, unknown> | null;
  legacyId?: number | null;
  occurredAt?: Date;
  createdAt?: Date;
}
