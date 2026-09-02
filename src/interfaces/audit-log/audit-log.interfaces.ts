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

/* ─────────────────────────── read side (P3) ───────────────────────────────
 *
 * The types below are what the read API returns. They exist here, next to
 * `IAuditLog`, because the ledger row and the view of it are two halves of one
 * contract: the row is what the trigger wrote, the view is what an auditor may
 * see. T4's presenter is the only place one becomes the other.
 *
 * **The rule that shapes all of them** (§0.3, ruling R-2): `sanitizeResponse`
 * deletes the key `id` and every key ending in `Id` whose value is a *number*,
 * recursively through objects and arrays. So:
 * - `userId`, `actorCompanyId`, `companyId`, `entityId`, `entityLegacyId` and
 *   `legacyId` appear in **no** view type. They would be stripped in flight,
 *   and a documented field that never arrives is worse than an absent one.
 * - `transactionRef` is a **string** (`String(txId)`); a field named `txId`
 *   carrying a bigint is a coin flip between number and string depending on
 *   the pg parser, and the number case vanishes.
 * - a diff is an **array of objects**, never a map: `{ key: "customerId" }`
 *   survives because the column name is a *value*; `{ customerId: 7 }` does
 *   not survive at all.
 * - `requestId` ends in `Id` but always carries a uuid *string* — never coerce
 *   it to a number.
 */

/**
 * Who performed the change, as far as the ledger knows.
 *
 * `attributed` is false for the rows P1 could not attribute — uploads
 * (`detachAudit`) and the public auth/invitation routes write `source='sql'`
 * with a null `username` (§0.4). The API says so explicitly rather than
 * emitting a blank name, so the UI can render "Sistema" / "Sin atribuir".
 *
 * `isSupport` is `actorCompanyId != null && actorCompanyId !== companyId`,
 * computed by the presenter: it is the one thing the two numeric company
 * columns are for, and neither of them leaves the API.
 */
export type AuditActor = {
  username: string | null;
  role: string | null;
  isSupport: boolean;
  attributed: boolean;
};

/**
 * One changed column. `key` is the raw column name and `label` is what the
 * frontend shows (today the presenter sets `label = key`; labels are the SPA's
 * job, decision Q-C1).
 *
 * `redacted: true` means the column is in `AUDIT_REDACT` — it is named in
 * `changedKeys` but its values were never stored, so `before`/`after` are
 * absent, not null-because-empty. `resolved: false` means the value is a
 * foreign key whose target is not in `AUDIT_FK_TABLE`, so no label could be
 * built; the raw number is then withheld (R-4) rather than leaked.
 */
export type AuditDiffEntry = {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
  redacted?: boolean;
  resolved?: boolean;
};

/** One ledger row as the client sees it. `diff` only when asked for. */
export type AuditRowView = {
  uuid: string;
  occurredAt: string;
  entityName: string;
  entityUuid: string | null;
  entityCode: string | null;
  entityDescription: string | null;
  operation: AuditOperation;
  action: string | null;
  source: AuditSourceValue;
  transactionRef: string;
  requestId: string | null;
  rootEntity: string | null;
  rootUuid: string | null;
  actor: AuditActor;
  changedKeys: string[];
  diff?: AuditDiffEntry[];
  /** `GET /audit-logs/:uuid` only: the whole snapshot, in the diff's shape. */
  beforeFields?: AuditDiffEntry[];
  afterFields?: AuditDiffEntry[];
  /** `{ ip, ua, route }`; recommended on `GET /:uuid` only (§0.3). */
  context?: Record<string, unknown> | null;
};

/**
 * One transaction of a record's history: every row `txId` grouped together,
 * the record's own row first and its children after.
 *
 * `truncated` is true when the transaction wrote more rows than
 * `HISTORY_ROWS_PER_ENTRY_CAP` and the entry shows only the first page of
 * them — a bulk import must not return ten thousand rows inside one entry.
 */
export type HistoryEntry = {
  transactionRef: string;
  occurredAt: string;
  actor: AuditActor;
  action: string | null;
  summary: string;
  rows: AuditRowView[];
  truncated: boolean;
};

/**
 * The date window a read actually applied (§4c). Echoed on every list and
 * export response: a superAdmin with neither a company nor a date gets the
 * last 90 days, and must be told so rather than shown a silently short answer.
 * Both null means "no date bound was applied".
 */
export type AuditWindow = {
  appliedFrom: string | null;
  appliedTo: string | null;
};

/**
 * One transaction's raw rows, as `getHistory` returns them. Not a view type —
 * T4's presenter turns each of these into a `HistoryEntry`.
 */
export type AuditHistoryGroup = {
  txId: string;
  occurredAt: Date;
  rows: IAuditLog[];
  truncated: boolean;
};

/** `listForExport`'s result: rows plus the two things T6's headers need. */
export type AuditExportResult = AuditWindow & {
  rows: IAuditLog[];
  truncated: boolean;
};
