import { Request, Response, NextFunction } from "express";
import {
  AUDIT_EXPORT_ROW_CAP,
  AuditLogDAO,
} from "../../dao/audit-log/audit-log.dao";
import { AuditRowView } from "../../interfaces/audit-log/audit-log.interfaces";
import { AuditPresenterService } from "../../services/audit-presenter.service";
import { todayInBuenosAires } from "../../utils/buenosAiresDay";
import { CsvValue, toCsv } from "../../utils/csv";
import {
  AUDIT_NO_UUID,
  AUDIT_PARENT,
  auditDbFor,
  auditedTablesOf,
} from "../../database/audit-coverage";
import { DB_KEYS } from "../../database/keys";
import { parseQueryParams } from "../../utils/queryBuilder";

/**
 * Every audited table, across every database key. `files` is fanned out to
 * three keys and appears once here — the set answers "may this name be
 * audited?", which has one answer per table.
 */
const AUDITED_TABLES: ReadonlySet<string> = new Set(
  DB_KEYS.flatMap((key) => auditedTablesOf(key)),
);

/**
 * `GET /audit-logs/entities` — computed once at load, because the manifest is
 * a constant and this list is a menu, not a query.
 *
 * `labelKey` and **no** `label`: labels are the SPA's job (§0.2-5, decision
 * Q-C1). The API ships no i18n and no `entityLabel` field, which would only
 * echo `entityName`. `database` comes from `auditDbFor`, the single place a
 * `DbKey` is chosen (R-3), so a fanned-out table reports the key its ledger
 * rows are actually read from rather than all three of its homes.
 */
const AUDIT_ENTITIES = [...AUDITED_TABLES].sort().map((table) => ({
  key: table,
  database: auditDbFor(table),
  labelKey: `audit.entities.${table}`,
}));

/** The `operation` CHECK vocabulary (`audit-triggers.ts:98`). */
const OPERATIONS: ReadonlySet<string> = new Set([
  "Alta",
  "Baja",
  "Modificacion",
]);

/** The `source` CHECK vocabulary (`audit-triggers.ts:106`). */
const SOURCES: ReadonlySet<string> = new Set([
  "api",
  "job",
  "seed",
  "migration",
  "script",
  "sql",
]);

/**
 * RFC 4122 shape, not `validateUUID`'s v4-strict form.
 *
 * The job here is to keep a malformed value out of Postgres — a non-uuid
 * compared to a `uuid` column raises `22P02`, and a filter must never be able
 * to turn a typo into an error page. Demanding version 4 on top of that would
 * reject a legitimate uuid the caller was handed by this very API if any row
 * ever carries another version, which is a 400 nobody could act on.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 date or date-time; `Date.parse` then confirms it is a real date. */
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** `txId` is a bigint column; anything else raises `22P02`. */
const DIGITS_RE = /^\d+$/;

const isIsoDate = (value: string): boolean =>
  ISO_RE.test(value) && !Number.isNaN(Date.parse(value));

/**
 * Every value a query param carries. Express turns `?a=1&a=2` into an array,
 * and `?a[b]=1` into an object — which stringifies to something no vocabulary
 * accepts, so it fails validation instead of reaching the DAO.
 */
const valuesOf = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => String(entry));
};

const firstBad = (
  values: string[],
  ok: (value: string) => boolean,
): string | undefined => values.find((value) => !ok(value));

/**
 * Every documented 400 of §P3.1, as an explicit check (§0.2-2).
 *
 * None of these happens by itself: `applyFilters` drops an unknown filter key
 * silently and on purpose ("do not leak schema via 400s"), and a *known* key
 * with a nonsense value goes straight to Postgres, where it is either a 500
 * (`22P02` on a uuid or a bigint column) or, worse, a silently empty result.
 * So the contract is written here, before the DAO runs, and nowhere else.
 *
 * @returns the message for a 400, or `null` when the query is acceptable.
 */
const validateListQuery = (query: Request["query"]): string | null => {
  const entityName = firstBad(valuesOf(query.entityName), (value) =>
    AUDITED_TABLES.has(value),
  );
  if (entityName !== undefined) {
    return `entityName "${entityName}" is not an audited table.`;
  }

  for (const param of ["entityUuid", "rootUuid", "requestId"] as const) {
    const bad = firstBad(valuesOf(query[param]), (value) =>
      UUID_RE.test(value),
    );
    if (bad !== undefined) return `${param} "${bad}" is not a valid uuid.`;
  }

  const operation = firstBad(valuesOf(query.operation), (value) =>
    OPERATIONS.has(value),
  );
  if (operation !== undefined) {
    return `operation "${operation}" is not one of ${[...OPERATIONS].join(", ")}.`;
  }

  const source = firstBad(valuesOf(query.source), (value) =>
    SOURCES.has(value),
  );
  if (source !== undefined) {
    return `source "${source}" is not one of ${[...SOURCES].join(", ")}.`;
  }

  // Not in §P3.1's list, but the same failure mode as a malformed uuid: the
  // column is a bigint, so `?transactionRef=abc` is a `22P02`, i.e. a 500 for
  // a client typo. Validated for the same reason the uuids are.
  const transactionRef = firstBad(valuesOf(query.transactionRef), (value) =>
    DIGITS_RE.test(value),
  );
  if (transactionRef !== undefined) {
    return `transactionRef "${transactionRef}" is not a transaction reference.`;
  }

  const from = valuesOf(query.from);
  const to = valuesOf(query.to);
  const badDate = firstBad([...from, ...to], isIsoDate);
  if (badDate !== undefined) {
    return `"${badDate}" is not a valid ISO 8601 date.`;
  }
  for (const start of from) {
    for (const end of to) {
      if (Date.parse(start) > Date.parse(end)) {
        return "from must not be later than to.";
      }
    }
  }

  // `changedKeys @> ARRAY[key]` asks about ONE key. Repeated, `applyFilters`
  // would build `whereIn("changedKeys", [[a],[b]])` — a different, wrong
  // question — and the DAO defensively keeps the last value. Reject it here so
  // the API never quietly answers something other than what was asked.
  if (valuesOf(query.changedKey).length > 1) {
    return "changedKey may be given only once.";
  }

  const include = firstBad(valuesOf(query.include), (value) =>
    value.split(",").every((token) => token.trim() === "diff"),
  );
  if (include !== undefined) {
    return `include "${include}" is not supported; the only value is "diff".`;
  }

  return null;
};

/** `?include=diff` — the only thing a list row carries beyond the plain view. */
const wantsDiff = (query: Request["query"]): boolean =>
  valuesOf(query.include).some((value) =>
    value.split(",").some((token) => token.trim() === "diff"),
  );

/**
 * The CSV export's columns, in the order they appear in the file (T6, AC-8).
 *
 * **Sanitizer-safe by construction.** Every other endpoint answers through
 * `res.json`, so `sanitizeResponse` strips `id` and every numeric `*Id` on the
 * way out — a safety net. The export answers through `res.send` and has none:
 * whatever is written into a cell reaches the client. So the cells are built
 * from `AuditRowView`, whose type carries no `id`, `userId`, `companyId`,
 * `entityId`, `actorCompanyId`, `entityLegacyId` or `legacyId` at all
 * (§0.3), rather than from the raw ledger row the DAO returned.
 *
 * Why these columns: the ledger row minus the two things that cannot be
 * rendered flat. `diff` is an array of objects (one cell per changed column is
 * not a table shape) and the raw `before`/`after` snapshots are the whole
 * reason R-2 exists — `changedKeys` names what changed, and
 * `GET /audit-logs/:uuid` on the row's own uuid, the last column, shows the
 * values. Everything else a reader needs to answer "who changed what, when,
 * from where, in which save" is here: the timestamp, the record (table, uuid,
 * code, description), the change (operation, action, source), the actor
 * (username, role, support flag) and the two correlation handles a support
 * conversation quotes, `transactionRef` and `requestId`.
 *
 * Spanish headers, and Spanish for the two rendered flags, following
 * `countdown-export.service.ts` (`STATUS_LABEL`, "Título", "Vence"): an export
 * is a leaf artifact with no client to label it, so the "labels are the SPA's
 * job" rule of §0.2-5 — which is about `entityLabel` in the JSON API — has
 * nothing to attach to here.
 */
const AUDIT_CSV_COLUMNS: ReadonlyArray<{
  header: string;
  cell: (view: AuditRowView) => CsvValue;
}> = [
  { header: "Fecha", cell: (view) => view.occurredAt },
  { header: "Entidad", cell: (view) => view.entityName },
  { header: "Registro", cell: (view) => view.entityUuid },
  { header: "Código", cell: (view) => view.entityCode },
  { header: "Descripción", cell: (view) => view.entityDescription },
  { header: "Operación", cell: (view) => view.operation },
  { header: "Acción", cell: (view) => view.action },
  { header: "Origen", cell: (view) => view.source },
  // An unattributed row (an upload, a public auth route: §0.4) carries a null
  // username. A blank cell reads as "the export lost it"; the JSON API says
  // `attributed: false` and the CSV, which has no renderer downstream, says it
  // in the only place a reader looks.
  {
    header: "Usuario",
    cell: (view) =>
      view.actor.attributed ? view.actor.username : "Sin atribuir",
  },
  { header: "Rol", cell: (view) => view.actor.role },
  {
    header: "Soporte",
    cell: (view) => (view.actor.isSupport ? "Sí" : "No"),
  },
  { header: "Transacción", cell: (view) => view.transactionRef },
  { header: "Solicitud", cell: (view) => view.requestId },
  { header: "Entidad raíz", cell: (view) => view.rootEntity },
  { header: "Registro raíz", cell: (view) => view.rootUuid },
  // One cell, comma-joined, because a spreadsheet column may not change arity
  // per row. `csvCell` quotes it, so the commas inside are never delimiters.
  {
    header: "Campos modificados",
    cell: (view) => view.changedKeys.join(", "),
  },
  { header: "Auditoría (uuid)", cell: (view) => view.uuid },
];

/**
 * The header row followed by one row per view. Exported because it is the unit
 * under test: `csv.test.ts` asserts that no column of this table is a numeric
 * id, which is the one invariant the sanitizer is not there to catch.
 */
export const auditCsvTable = (views: AuditRowView[]): CsvValue[][] => [
  AUDIT_CSV_COLUMNS.map((column) => column.header),
  ...views.map((view) => AUDIT_CSV_COLUMNS.map((column) => column.cell(view))),
];

/**
 * `auditoria-2026-06-04_2026-09-02.csv` — the applied window, in the name.
 *
 * A read with neither a company nor a date bound is silently narrowed to the
 * last 90 days by the DAO (§4c), and §4c requires that window to be echoed
 * rather than left silent. The list endpoint echoes it as `appliedFrom` /
 * `appliedTo` on the paginator; a CSV body has nowhere to put it, and an
 * `X-Audit-Window` header would need adding to `app.ts`'s CORS
 * `exposedHeaders` — which this track may not touch (§0.2-4) — so a browser
 * could not read it. The filename can carry it, is visible to the user without
 * any CORS at all, and lands sortable next to last month's export.
 *
 * Built in Buenos Aires time like the countdown export: `toISOString()` names
 * the file after tomorrow between 21:00 and midnight local.
 */
const auditCsvFileName = (
  appliedFrom: string | null,
  appliedTo: string | null,
): string => {
  const today = todayInBuenosAires();
  const day = (value: string | null, fallback: string): string =>
    value ? value.slice(0, 10) : fallback;
  return `auditoria-${day(appliedFrom, "inicio")}_${day(appliedTo, today)}.csv`;
};

/**
 * The read API for the audit ledger (P3 §P3.1, track T5).
 *
 * **There is no write path.** Since P2 every row is written by the database
 * trigger `audit_row_change` inside the request's own transaction, and
 * `audit_logs` is append-only in the database itself (`audit_logs_protect`);
 * the one sanctioned door for removing rows is `company-purge.service.ts`.
 *
 * Five routes, in the registration order `src/routes/audit-logs/` uses —
 * `/entities` and `/export.csv` MUST come before `/:uuid` or Express matches
 * them as a uuid and `validateUUID()` 400s them:
 *
 * | Route | Gate |
 * |---|---|
 * | `GET /entities` | `requirePermission("audit.read", {allowReadOnly:true})` |
 * | `GET /export.csv` | `requirePermission("audit.export")` — T6 |
 * | `GET /history/:entityName/:entityUuid` | `requireEntityHistoryAccess` |
 * | `GET /` | `requirePermission("audit.read", {allowReadOnly:true})` |
 * | `GET /:uuid` | `requirePermission("audit.read", {allowReadOnly:true})` |
 *
 * **Tenant scoping (L-009).** The company always comes from the caller's token
 * through `parseQueryParams`, never from a body: the list and the export lift
 * it inside the DAO, `getByUuid` is handed it explicitly, and `getHistory`
 * reads it from the same place. A superAdmin with no `?companyId` sees every
 * tenant, which is the specified behaviour.
 *
 * **A row of another tenant reads as absent, never as forbidden** (AC-7): the
 * scope is part of the query, so a cross-tenant `GET /:uuid` or history request
 * answers **404**. The cost is that a record whose ledger is genuinely empty —
 * one created before P2's triggers existed — also answers 404 on its history;
 * that is the only way to be unable to distinguish the two, which is the point.
 *
 * **Unattributed rows (§0.4).** Uploads (`detachAudit`) and the six public
 * auth/invitation routes run without `armAudit`, so their rows carry
 * `source='sql'` and a NULL `username`. The presenter emits
 * `actor.attributed = false` with `username: null, role: null` rather than a
 * blank name, so P4 can render "Sistema" / "Sin atribuir".
 *
 * **Numeric ids never leave** (§0.3, R-2): every response body is built by
 * `AuditPresenterService`, which is sanitizer-proof by construction. No handler
 * here ever emits a raw ledger row.
 */
export class AuditLogController {
  private dao = new AuditLogDAO();
  private presenter = new AuditPresenterService();

  /**
   * `GET /audit-logs` — the ledger browser.
   *
   * A standard query-builder endpoint (filters, `search`, `page`/`limit`,
   * `sortBy=occurredAt`), returned unwrapped, plus `appliedFrom`/`appliedTo`:
   * a read with neither a company nor a date bound is defaulted to the last 90
   * days by the DAO (§4c) and the caller is told so rather than shown a
   * silently short answer.
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const invalid = validateListQuery(req.query);
      if (invalid) {
        req.statusCode = 400;
        return next(new Error(invalid));
      }

      const { data, ...paginator } = await this.dao.getAllWithFilters(req);
      const rows = await this.presenter.presentList(data, {
        includeDiff: wantsDiff(req.query),
      });

      res.status(200).json({ ...paginator, data: rows });
    } catch (err) {
      next(err);
    }
  }

  /** `GET /audit-logs/entities` — the filter dropdown's contents. */
  public async getEntities(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      res.status(200).json({ success: true, data: AUDIT_ENTITIES });
    } catch (err) {
      next(err);
    }
  }

  /**
   * `GET /audit-logs/export.csv` — the same filtered set as the list, as a
   * spreadsheet instead of a page (T6, AC-8).
   *
   * Mirrors the countdown export (`countdown-document.controller.ts:197-229`),
   * which is the house pattern for a download: one query, one in-memory
   * document, a hard row cap, the server-chosen filename in
   * `Content-Disposition`, and `X-Export-Rows` / `X-Export-Truncated` so the
   * SPA can tell a complete file from a capped one without opening it. Both
   * headers are already in `app.ts`'s CORS `exposedHeaders`.
   *
   * `X-Export-Rows` counts **data** lines, not the header — it is the answer to
   * "how many ledger entries are in this file".
   *
   * The 10 000-row cap lives in the DAO (`AUDIT_EXPORT_ROW_CAP`), which reports
   * back whether it bit; the file is still served, because a truncated export
   * the user knows about beats a 400 they cannot act on, and the `console.warn`
   * is what tells us the cap is too low in practice.
   *
   * Gated by `requirePermission("audit.export")` — no `allowReadOnly`: taking
   * the whole ledger off the platform in one request is a separate decision
   * from reading it on screen.
   *
   * Validation is `validateListQuery`, the *same function* `getAll` uses, so
   * the export cannot drift into accepting a filter the list rejects (or vice
   * versa) — a 400 here must mean exactly what a 400 there means.
   */
  public async exportCsv(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const invalid = validateListQuery(req.query);
      if (invalid) {
        req.statusCode = 400;
        return next(new Error(invalid));
      }

      const { rows, truncated, appliedFrom, appliedTo } =
        await this.dao.listForExport(req);
      if (truncated) {
        console.warn(
          `[audit][export] capped at ${AUDIT_EXPORT_ROW_CAP} rows — the file is incomplete`,
        );
      }

      // The presenter, not the raw rows: `res.send` bypasses `sanitizeResponse`
      // (§0.3), so this is the only thing keeping numeric ids out of the file.
      const views = await this.presenter.presentList(rows);
      const fileName = auditCsvFileName(appliedFrom, appliedTo);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader("X-Export-Rows", String(views.length));
      if (truncated) res.setHeader("X-Export-Truncated", "1");
      res.send(toCsv(auditCsvTable(views)));
    } catch (err) {
      next(err);
    }
  }

  /**
   * `GET /audit-logs/history/:entityName/:entityUuid` — one record's whole
   * history, grouped by transaction and paginated over transactions, so a save
   * that touched six child tables is one entry rather than six rows spread
   * across two pages. Never date-defaulted: a record's history must be
   * complete.
   *
   * Access is decided by `requireEntityHistoryAccess` (R-1) before this runs.
   */
  public async getHistory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const entityName = req.params.entityName ?? "";
      const entityUuid = req.params.entityUuid ?? "";

      const invalid = this.validateHistoryTarget(entityName, entityUuid);
      if (invalid) {
        req.statusCode = 400;
        return next(new Error(invalid));
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const { data, ...paginator } = await this.dao.getHistory(
        entityName,
        entityUuid,
        page,
        limit,
        req,
      );

      // 404, never 403: another tenant's record must read as absent (AC-7).
      if (paginator.totalCount === 0) {
        res.status(404).json({
          success: false,
          message: "No audit history found for this record.",
        });
        return;
      }

      const entries = await this.presenter.presentHistory(
        data,
        entityName,
        entityUuid,
      );

      res.status(200).json({ ...paginator, data: entries });
    } catch (err) {
      next(err);
    }
  }

  /**
   * `GET /audit-logs/:uuid` — one row with its `diff`, both snapshots in the
   * diff's array shape (`beforeFields`/`afterFields`) and its context.
   *
   * Raw `before`/`after` maps are deliberately not emitted (R-2): the sanitizer
   * deletes every numeric `*Id` inside them, so the documented payload would
   * not be the payload delivered — for exactly the fields an auditor wants.
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // Token-derived scope (L-009); `parseQueryParams` is where every list DAO
      // gets it, so the detail endpoint cannot drift from them.
      const companyUuid = parseQueryParams(req).filters.companyId as
        | string
        | undefined;

      const row = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!row) {
        res.status(404).json({
          success: false,
          message: "Audit entry not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: await this.presenter.presentOne(row),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * The two 400s that belong to the history target itself (AC-9, R-5).
   *
   * Order matters: the audited-table check runs first, so `code_sequences` —
   * which has no `uuid` **and** carries no trigger at all — is refused as "not
   * an audited table" rather than pointed at a parent it does not have.
   */
  private validateHistoryTarget(
    entityName: string,
    entityUuid: string,
  ): string | null {
    if (!AUDITED_TABLES.has(entityName)) {
      return `entityName "${entityName}" is not an audited table.`;
    }

    if (AUDIT_NO_UUID.has(entityName)) {
      const parent = AUDIT_PARENT[entityName]?.parent;
      // `company_modules` is the parentless case: it has no `uuid` and no
      // `AUDIT_PARENT` entry (`companyId` already scopes it), so there is no
      // parent to name. Its rows are reachable through the transaction they
      // were written in, via `GET /audit-logs?transactionRef=…`.
      return parent
        ? `history for ${entityName} is reached through its parent ${parent}.`
        : `history for ${entityName} is not addressable: its rows carry no entityUuid and it has no parent entity.`;
    }

    if (!UUID_RE.test(entityUuid)) {
      return `entityUuid "${entityUuid}" is not a valid uuid.`;
    }

    return null;
  }
}
