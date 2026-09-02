import { Request } from "express";
import { Knex } from "knex";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  AuditExportResult,
  AuditHistoryGroup,
  AuditWindow,
  IAuditLog,
} from "../../interfaces/audit-log/audit-log.interfaces";
import { auditDbFor } from "../../database/audit-coverage";
import {
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type ParsedQuery,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";

/**
 * Every filter the read API accepts (P3 §4). Defined outside the class per the
 * endpoint guide, so `GET /audit-logs` is a standard query-builder endpoint
 * like the other ~50.
 *
 * Notes on the three that are not obvious:
 * - `transactionRef` maps to the `txId` column. The *view* field is a string
 *   (a numeric key ending in `Id` would be stripped by `sanitizeResponse`), so
 *   the filter carries the same name the client was given; two names for one
 *   thing is how a filter ends up unused (§0.2-6).
 * - `changedKey` compares `text[] @> text[]`, so the bound value must be an
 *   **array**. `applyFilters` tests `Array.isArray` on the *raw* query value —
 *   a string — so the transform's array reaches the default branch and knex
 *   binds it as an array parameter. Written as a bare string the operator
 *   would either error or, worse, degrade to a no-op filter (L-007).
 * - `from`/`to` bind the ISO strings verbatim; Postgres parses them against
 *   `timestamptz`. ISO validity and `from <= to` are 400s produced by the
 *   controller (T5) *before* this DAO runs — unknown/invalid filter values are
 *   silently dropped here by design (§0.2-2), so a 400 can never come from the
 *   query builder.
 *
 * `userId` is deliberately not a filter: numeric ids never cross the API.
 * Filter by `username` instead.
 */
export const AUDIT_LOG_FILTERS: FilterConfigs = {
  entityName: { column: "entityName", operator: "=" },
  entityUuid: { column: "entityUuid", operator: "=" },
  rootUuid: { column: "rootUuid", operator: "=" },
  operation: { column: "operation", operator: "=" },
  action: { column: "action", operator: "=" },
  source: { column: "source", operator: "=" },
  username: { column: "username", operator: "ILIKE" },
  requestId: { column: "requestId", operator: "=" },
  transactionRef: { column: "txId", operator: "=" },
  from: { column: "occurredAt", operator: ">=" },
  to: { column: "occurredAt", operator: "<=" },
  changedKey: {
    column: "changedKeys",
    operator: "@>",
    transform: (value: string) => [value],
  },
};

/**
 * `occurredAt` only (§0.2-7). The ledger is a chronology; sorting it by
 * `entityName` or `username` produced pages nobody could reason about and,
 * worse, pages no index supports. Unknown sort keys already fall back to the
 * default, so the two dropped keys degrade to `occurredAt desc`.
 */
const AUDIT_LOG_SORTING: SortConfigs = {
  occurredAt: { column: "occurredAt" },
};

const AUDIT_LOG_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  "audit_logs",
  {
    filters: AUDIT_LOG_FILTERS,
    sorting: AUDIT_LOG_SORTING,
    search: { columns: ["entityCode", "entityDescription"], operator: "ILIKE" },
    defaultSort: { column: "occurredAt", order: "desc" },
  },
);

/** Hard cap on an export, mirroring `COUNTDOWN_EXPORT_ROW_CAP`. */
export const AUDIT_EXPORT_ROW_CAP = 10000;

/** Days of history a read defaults to when it is otherwise unbounded (§4c). */
export const AUDIT_DEFAULT_WINDOW_DAYS = 90;

/** Entries (transactions) per history page, clamped like `parseQueryParams`. */
export const HISTORY_MAX_LIMIT = 100;

/** Rows one history entry may carry. One bulk import must not return 10 000. */
export const HISTORY_ROWS_PER_ENTRY_CAP = 200;

/**
 * The ledger's columns, in DDL order. Named explicitly rather than `*` because
 * the history query wraps its rows in a `row_number()` subquery and `*` would
 * carry the window column out with them.
 */
const AUDIT_COLUMNS = [
  "id",
  "uuid",
  "companyId",
  "entityName",
  "entityId",
  "entityUuid",
  "entityCode",
  "entityDescription",
  "operation",
  "before",
  "after",
  "changedKeys",
  "rootEntity",
  "rootUuid",
  "action",
  "source",
  "txId",
  "requestId",
  "username",
  "userId",
  "actorRole",
  "actorCompanyId",
  "context",
  "entityLegacyId",
  "legacyId",
  "occurredAt",
  "createdAt",
] as const;

const columnList = (alias: string): string =>
  AUDIT_COLUMNS.map((column) => `${alias}."${column}"`).join(", ");

/** `knex.raw` resolves to the driver's result; only `rows` is ever read. */
type RawResult<T> = { rows: T[] };

/**
 * The database an audit read runs against. `auditDbFor` is the single place a
 * `DbKey` is chosen (R-3); a filter naming several tables (a repeated
 * `?entityName=`) has no single owner, so it falls back to the default.
 */
const dbKeyForFilters = (
  filters: ParsedQuery["filters"],
): string | undefined =>
  typeof filters.entityName === "string" ? filters.entityName : undefined;

/**
 * Apply the default date window (§4c) and report what was applied.
 *
 * A read with **neither** a company nor a date bound has no leading index
 * column at all — `audit_logs` is partitioned monthly, so such a query
 * seq-scans every partition (15 today, 12 more a year) at a projected ~4.9 M
 * rows/year. That is the query that falls over first, and it is exactly the one
 * a superAdmin issues by opening the page. It gets the last 90 days, and the
 * caller is told so rather than shown a silently short answer.
 *
 * History is never date-defaulted: a record's history must be complete.
 */
const applyDefaultWindow = (
  filters: ParsedQuery["filters"],
  companyUuid: string | undefined,
): AuditWindow => {
  const unbounded = !companyUuid && !filters.from && !filters.to;
  if (unbounded) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - AUDIT_DEFAULT_WINDOW_DAYS);
    filters.from = since.toISOString();
  }

  const asIso = (value: unknown): string | null =>
    typeof value === "string" ? value : null;

  return { appliedFrom: asIso(filters.from), appliedTo: asIso(filters.to) };
};

/**
 * Repeated `?changedKey=a&changedKey=b` is rejected with 400 by the controller
 * (T5): `@>` takes one key. Should one reach here anyway, keep the last value
 * rather than letting `applyFilters` emit `whereIn("changedKeys", [[a],[b]])`,
 * which asks a different — and wrong — question.
 */
const normalizeChangedKey = (filters: ParsedQuery["filters"]): void => {
  const value = filters.changedKey;
  if (Array.isArray(value) && value.length > 0) {
    filters.changedKey = value[value.length - 1];
  }
};

/**
 * Reads of the audit ledger. There is no write half: since P2 every row is
 * written by the database trigger `audit_row_change`, and `audit_logs` is
 * append-only in the database itself (`audit_logs_protect`), so an INSERT from
 * here would be both redundant and, for UPDATE/DELETE, `P0001`. The one
 * sanctioned door for removing rows is `company-purge.service.ts`.
 *
 * **Tenant scoping (§0.2-8, L-009).** `parseQueryParams` writes the
 * token-derived `companies.uuid` into `filters.companyId`; every method here
 * lifts it out and turns it into a join (or, in raw SQL, a single-row
 * subselect) on `companies.uuid`. A superAdmin with no `?companyId` gets no
 * filter and sees all — which is the specified behaviour. The company is never
 * read from a body. This stays correct for the v2 ledger: ruling R-A made a
 * company's own rows carry its own id, and R-B's "no foreign keys" does not
 * affect a join.
 *
 * **Which database (R-3).** `auditDbFor(entityName)` is the only place a
 * `DbKey` is chosen; `?database=` is deliberately not shipped, because all four
 * keys resolve to one physical database today and the parameter therefore
 * provably cannot change a response (L-007). When the split cuts over, the
 * cross-key fan-out lands inside `auditDbFor`, not here. The `companies` join
 * is what stops working that day — the same day `auditDbFor` becomes real.
 */
export class AuditLogDAO {
  private tableName = "audit_logs";
  private queryConfig = AUDIT_LOG_QUERY_CONFIG;

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<IAuditLog> & AuditWindow> {
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;
    normalizeChangedKey(parsedQuery.filters);
    const window = applyDefaultWindow(parsedQuery.filters, companyUuid);

    const knex = db(auditDbFor(dbKeyForFilters(parsedQuery.filters)));

    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    this.scopeToCompany(dataQuery, companyUuid);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const countQuery = knex(this.tableName);
    this.scopeToCompany(countQuery, companyUuid);
    buildCountQuery(countQuery, parsedQuery, this.queryConfig);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows as IAuditLog[],
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
      ...window,
    };
  }

  /**
   * The same filter set as the list, unpaginated and capped, for T6's CSV.
   *
   * The cap is expressed through the shared builder (`parsedQuery.limit`) so
   * filters, search and sort cannot drift from the list endpoint's; `truncated`
   * is `rows.length === cap`, exactly as the countdown export decides it.
   */
  async listForExport(req: Request): Promise<AuditExportResult> {
    const parsedQuery: ParsedQuery = parseQueryParams(req);

    const companyUuid = parsedQuery.filters.companyId as string | undefined;
    delete parsedQuery.filters.companyId;
    normalizeChangedKey(parsedQuery.filters);
    const window = applyDefaultWindow(parsedQuery.filters, companyUuid);

    parsedQuery.page = 1;
    parsedQuery.limit = AUDIT_EXPORT_ROW_CAP;

    const knex = db(auditDbFor(dbKeyForFilters(parsedQuery.filters)));
    const dataQuery = knex(this.tableName).select(`${this.tableName}.*`);
    this.scopeToCompany(dataQuery, companyUuid);
    buildQuery(dataQuery, parsedQuery, this.queryConfig);

    const rows = (await dataQuery) as IAuditLog[];

    return {
      rows,
      truncated: rows.length === AUDIT_EXPORT_ROW_CAP,
      ...window,
    };
  }

  /**
   * One row, with `before`, `after` and `changedKeys`.
   *
   * `companyUuid` is the caller's token-derived scope and T5 passes it on every
   * request: a row belonging to another tenant must read as "not found", never
   * as "found but forbidden" (AC-7). It is optional only because a superAdmin
   * with no company selected has no scope to pass.
   */
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IAuditLog | null> {
    const knex = db(auditDbFor());
    const query = knex(this.tableName)
      .select(`${this.tableName}.*`)
      .where(`${this.tableName}.uuid`, uuid);
    this.scopeToCompany(query, companyUuid);

    const row = await query.first();
    return (row as IAuditLog | undefined) ?? null;
  }

  /**
   * One record's complete history, grouped by transaction.
   *
   * **Why a UNION and not an `OR` (§4a).** A row belongs to this record either
   * directly (`entityName`/`entityUuid`) or as a child written in the same
   * save (`rootEntity`/`rootUuid`). P2's indexes are
   * `("companyId","entityName","entityUuid","occurredAt")` and
   * `("companyId","rootEntity","rootUuid","occurredAt")`, so with the table
   * name known **both** legs have a full index prefix. Written as
   * `WHERE entityUuid = :u OR rootUuid = :u` Postgres may instead fall back to
   * a parallel seq scan *per partition* — 15 partitions today, 12 more every
   * year. The db test asserts the plan names both indexes; a mock cannot.
   *
   * **Why the pagination is hand-written.** The shared query builder paginates
   * rows; a history pages over *transactions*, so one save that touched six
   * child tables is one entry, not six rows spread across two pages. That is
   * not expressible with `buildQuery`, and this endpoint is a nested resource
   * rather than a main list endpoint, so the query-builder mandate does not
   * apply to it. `GET /audit-logs` above does use it, exactly like
   * `warehouse.dao.ts`. Three statements: the page of `txId`s, their count, and
   * their rows.
   *
   * **Never date-defaulted**, unlike the list (§4c): a record's history must be
   * complete. The company predicate keeps the index prefix regardless.
   *
   * **Known gap (§0.4).** A cascade-deleted child carries `rootUuid = NULL` —
   * its parent row was already gone when its trigger ran — so the `rootUuid`
   * leg misses it. The parent's own `Baja` shares the `txId`, so the deletion
   * is still visible as an entry; the child's own row is not. Accepted, and
   * covered by the db test so it stays a documented property.
   */
  async getHistory(
    entityName: string,
    entityUuid: string,
    page: number,
    limit: number,
    req: Request,
  ): Promise<IDataPaginator<AuditHistoryGroup>> {
    // Same scope path as every list DAO: token-derived, never from input.
    const companyUuid = parseQueryParams(req).filters.companyId as
      | string
      | undefined;

    const safePage = Math.max(Math.trunc(page) || 1, 1);
    const safeLimit = Math.min(
      Math.max(Math.trunc(limit) || 20, 1),
      HISTORY_MAX_LIMIT,
    );
    const offset = (safePage - 1) * safeLimit;

    const knex = db(auditDbFor(entityName));
    const source = historySource(companyUuid);
    const scope: Record<string, unknown> = { entityName, entityUuid };
    if (companyUuid) scope.companyUuid = companyUuid;

    const [txPage, totals] = await Promise.all([
      knex.raw(
        `SELECT s."txId", max(s."occurredAt") AS "at"
           FROM (${source}) s
          GROUP BY s."txId"
          ORDER BY "at" DESC, s."txId" DESC
          LIMIT :limit OFFSET :offset`,
        { ...scope, limit: safeLimit, offset },
      ) as unknown as Promise<RawResult<{ txId: string; at: Date }>>,
      knex.raw(
        `SELECT count(DISTINCT s."txId") AS count FROM (${source}) s`,
        scope,
      ) as unknown as Promise<RawResult<{ count: string }>>,
    ]);

    const totalCount = parseInt(totals.rows[0]?.count ?? "0") || 0;
    const totalPages = Math.ceil(totalCount / safeLimit);
    const empty = {
      success: true,
      data: [] as AuditHistoryGroup[],
      page: safePage,
      limit: safeLimit,
      count: 0,
      totalCount,
      totalPages,
    };
    if (txPage.rows.length === 0) return empty;

    const txIds = txPage.rows.map((entry) => entry.txId);
    const rowsResult = (await knex.raw(
      `SELECT ${columnList("r")}
         FROM (
           SELECT ${columnList("s")},
                  row_number() OVER (
                    PARTITION BY s."txId"
                    ORDER BY s."occurredAt" DESC, s."id" DESC
                  ) AS rn
             FROM (${source}) s
            WHERE s."txId" = ANY(:txIds)
         ) r
        WHERE r.rn <= :rowCap
        ORDER BY r."occurredAt" DESC, r."id" DESC`,
      { ...scope, txIds, rowCap: HISTORY_ROWS_PER_ENTRY_CAP },
    )) as unknown as RawResult<IAuditLog>;

    const byTx = new Map<string, IAuditLog[]>();
    for (const row of rowsResult.rows) {
      const key = String(row.txId);
      const bucket = byTx.get(key);
      if (bucket) bucket.push(row);
      else byTx.set(key, [row]);
    }

    const data: AuditHistoryGroup[] = txPage.rows.map((entry) => {
      const rows = byTx.get(String(entry.txId)) ?? [];
      return {
        txId: String(entry.txId),
        occurredAt: entry.at,
        // The record's own row first, its children after (§P3.2). `sort` is
        // stable in V8, so the `occurredAt DESC, id DESC` order the SQL
        // produced survives inside each half.
        rows: [...rows].sort(
          (a, b) =>
            ownRowRank(a, entityName, entityUuid) -
            ownRowRank(b, entityName, entityUuid),
        ),
        truncated: rows.length === HISTORY_ROWS_PER_ENTRY_CAP,
      };
    });

    return { ...empty, data, count: data.length };
  }

  /**
   * The tenant scope, lifted from `filters.companyId` into a join on
   * `companies.uuid` — the same shape every list DAO uses (§0.2-8). Undefined
   * means "superAdmin with no company selected": no predicate, sees all.
   */
  private scopeToCompany(
    query: Knex.QueryBuilder,
    companyUuid: string | undefined,
  ): void {
    if (!companyUuid) return;
    query
      .join("companies", `${this.tableName}.companyId`, "companies.id")
      .where("companies.uuid", companyUuid);
  }
}

/** Own rows sort before children; see `getHistory`. */
const ownRowRank = (
  row: IAuditLog,
  entityName: string,
  entityUuid: string,
): number =>
  row.entityName === entityName && row.entityUuid === entityUuid ? 0 : 1;

/**
 * The two index-prefixed legs of the history query, `UNION ALL`-ed (§4a).
 *
 * The company predicate is a single-row subselect rather than a join so that
 * `"companyId"` stays a leading equality on both indexes. It names `companies`
 * inside raw SQL, which the registry's raw boundary logger notices outside
 * production for a non-`erp` key — that warning is the split's cutover work
 * (§0.2-8), not a defect here.
 */
const historySource = (companyUuid: string | undefined): string => {
  const company = companyUuid
    ? `l."companyId" IN (SELECT c.id FROM companies c WHERE c.uuid = :companyUuid)`
    : "TRUE";

  return `SELECT ${columnList("l")}
             FROM audit_logs l
            WHERE ${company}
              AND l."entityName" = :entityName
              AND l."entityUuid" = :entityUuid
           UNION ALL
           SELECT ${columnList("l")}
             FROM audit_logs l
            WHERE ${company}
              AND l."rootEntity" = :entityName
              AND l."rootUuid" = :entityUuid`;
};
