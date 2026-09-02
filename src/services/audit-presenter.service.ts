import { db } from "../database/registry";
import { AUDIT_FK_TABLE, auditDbFor } from "../database/audit-coverage";
import {
  AuditActor,
  AuditDiffEntry,
  AuditHistoryGroup,
  AuditRowView,
  AuditSourceValue,
  HistoryEntry,
  IAuditLog,
} from "../interfaces/audit-log/audit-log.interfaces";

/**
 * The presenter (audit P3, track T4; AC-5, AC-6, AC-10).
 *
 * This is the **only** place a raw ledger row becomes a client shape, and the
 * reason it exists is `sanitizeResponse`
 * (`src/middlewares/sanitize-response.middleware.ts`): it deletes the key `id`
 * and every key ending in `Id` whose value is a *number*, recursively through
 * objects and arrays, on every response, and it never errors. A raw snapshot
 * `{"id":41,"customerId":7,"name":"X"}` therefore reaches the client as
 * `{"name":"X"}` — the foreign key an auditor most wants to see, silently gone,
 * with a 200 status.
 *
 * So everything emitted here is sanitizer-proof **by construction**, not by
 * filtering afterwards (ruling R-2):
 *
 * 1. `transactionRef = String(txId)`. `txId` is a bigint, which the pg parser
 *    hands over as a string or a number depending on its configuration; the
 *    number case would vanish. The field is never named `txId`.
 * 2. Column names are **values**, never object keys: a diff is
 *    `Array<{key, label, before, after}>`. As a map, `{customerId: …}` puts a
 *    column name in key position and the sanitizer decides its fate — which is
 *    the defect this shape exists to make impossible.
 * 3. `userId`, `companyId`, `actorCompanyId`, `entityId`, `entityLegacyId` and
 *    `legacyId` are never selected into a view. `isSupport` is the one thing
 *    the two numeric company columns are for, and it is computed here.
 * 4. A numeric foreign-key *value* is replaced by a human label (R-4) or
 *    withheld (`resolved:false`) — never emitted as a bare number, which the
 *    sanitizer would not strip (it sits under `before`/`after`, not under a key
 *    ending in `Id`) and which would be an internal-id leak.
 *
 * The unit suite walks the whole emitted JSON through the real
 * `sanitizeResponse` and asserts nothing changes; it is mutation-checked, so
 * breaking any of the four above turns it red.
 */

/**
 * The columns a label is read from, in order of preference. A table with none
 * of them (`users` is the notable one — it has `email`, `first_name`,
 * `last_name` and no `name`) yields `resolved:false` for every reference to
 * it, which is the designed fallback (R-4): an unlabelled foreign key is an
 * enhancement gap, never a leaked number.
 */
/**
 * Tried in order; the first column the referenced table actually has wins.
 *
 * `email` is here for `users`, which has none of the other three (it has
 * `email`, `first_name`, `last_name`). Without it every `userId`,
 * `assignedTo`, `uploadedBy` and `salesPersonId` in a diff resolves to
 * `resolved: false`, and the history drawer reads "assigned user changed
 * from — to —" for the FKs a reader most often cares about. It is last, so
 * no table that has a real code or name is affected.
 */
const FK_LABEL_COLUMNS = ["code", "name", "description", "email"] as const;

/**
 * A value is "id-shaped" — i.e. must never leave as a bare number — when its
 * column is an internal key. `id` and `*Id` are the sanitizer's own rule; a
 * column named in `AUDIT_FK_TABLE` is included because the schema also spells
 * foreign keys `uploadedBy`, `invitedBy`, `managerId`… and a numeric
 * `uploadedBy` would sail past the sanitizer untouched.
 *
 * `*Uuid` columns are in `AUDIT_FK_TABLE` too, but they carry strings and
 * therefore never reach this branch.
 */
const isIdShaped = (key: string, value: unknown): boolean =>
  typeof value === "number" &&
  (key === "id" || key.endsWith("Id") || key in AUDIT_FK_TABLE);

/** A ledger row always carries `occurredAt`; the empty string is unreachable. */
const isoOf = (value: Date | string | null | undefined): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
};

const has = (
  snapshot: Record<string, unknown> | null | undefined,
  key: string,
) => snapshot != null && Object.prototype.hasOwnProperty.call(snapshot, key);

/**
 * Batched foreign-key label lookup, one instance per response (R-4).
 *
 * Two phases on purpose: every row of the page declares what it needs
 * (`want`), then **one `whereIn` per table** answers all of it (`load`), then
 * the views are built synchronously (`labelFor`). A per-row lookup would issue
 * one query per foreign key per row — 100 rows × 3 keys = 300 round trips for
 * one page of the audit list.
 *
 * The lookup is not tenant-scoped: the ids come from ledger rows the caller has
 * already been authorised to read, and the label columns are not per-company
 * secrets. It resolves through `auditDbFor(table)` so it keeps working the day
 * the database-per-module split makes that meaningful.
 */
class FkLabelResolver {
  private wanted = new Map<string, Set<number>>();
  private labels = new Map<string, string>();

  want(key: string, value: unknown): void {
    const table = AUDIT_FK_TABLE[key];
    if (!table || typeof value !== "number") return;
    const ids = this.wanted.get(table);
    if (ids) ids.add(value);
    else this.wanted.set(table, new Set([value]));
  }

  async load(): Promise<void> {
    await Promise.all(
      [...this.wanted.entries()].map(async ([table, ids]) => {
        const knex = db(auditDbFor(table));
        // `to_jsonb(<table>) ->> '<column>'` reads whichever of the label
        // columns the table actually has and yields NULL for the rest, so no
        // per-table column map and no `information_schema` round trip is
        // needed. The table name is bound as an identifier (`??`), never
        // interpolated, and its only source is the constant `AUDIT_FK_TABLE`.
        const label = FK_LABEL_COLUMNS.map(
          (column) => `to_jsonb(??) ->> '${column}'`,
        ).join(", ");
        const bindings = FK_LABEL_COLUMNS.map(() => table);
        const rows = (await knex(table)
          .select("id")
          .select(knex.raw(`coalesce(${label}) as label`, bindings))
          .whereIn("id", [...ids])) as Array<{
          id: number;
          label: string | null;
        }>;

        for (const row of rows) {
          if (row.label) this.labels.set(`${table}#${row.id}`, row.label);
        }
      }),
    );
  }

  /** The label, or `undefined` when the column is unmapped or the row is gone. */
  labelFor(key: string, value: unknown): string | undefined {
    const table = AUDIT_FK_TABLE[key];
    if (!table || typeof value !== "number") return undefined;
    return this.labels.get(`${table}#${value}`);
  }
}

/** What a caller wants on top of the plain row view. */
export type AuditPresentOptions = {
  /** `?include=diff` on the list; always on for `GET /:uuid` and history. */
  includeDiff?: boolean;
  /** `beforeFields`/`afterFields` — the whole snapshot, in the diff's shape. */
  includeSnapshots?: boolean;
  /** `{ip, ua, route}`; recommended on `GET /:uuid` only (§0.3). */
  includeContext?: boolean;
};

const OPERATION_NOUN: Record<string, [string, string]> = {
  Alta: ["alta", "altas"],
  Baja: ["baja", "bajas"],
  Modificacion: ["modificación", "modificaciones"],
};

const OWN_ROW_PHRASE: Record<string, string> = {
  Alta: "Alta de",
  Baja: "Baja de",
  Modificacion: "Modificación de",
};

export class AuditPresenterService {
  /** A page of ledger rows. One `whereIn` per foreign-key table for the page. */
  async presentList(
    rows: IAuditLog[],
    options: AuditPresentOptions = {},
  ): Promise<AuditRowView[]> {
    const resolver = new FkLabelResolver();
    for (const row of rows) this.declare(row, options, resolver);
    await resolver.load();
    return rows.map((row) => this.build(row, options, resolver));
  }

  /** `GET /audit-logs/:uuid` — the diff, both snapshots and the context. */
  async presentOne(row: IAuditLog): Promise<AuditRowView> {
    const [view] = await this.presentList([row], {
      includeDiff: true,
      includeSnapshots: true,
      includeContext: true,
    });
    return view;
  }

  /**
   * A page of history entries, one per transaction.
   *
   * The diff is always included: an entry whose rows carry no diff is a list of
   * "something changed", which is what the drawer exists not to be. `rows`
   * keeps the record's own row first and its children after — the DAO already
   * orders them that way, and this sort is stable, so it is an assertion of the
   * contract rather than a second opinion about it.
   */
  async presentHistory(
    groups: AuditHistoryGroup[],
    entityName: string,
    entityUuid: string,
  ): Promise<HistoryEntry[]> {
    const options: AuditPresentOptions = { includeDiff: true };
    const resolver = new FkLabelResolver();
    for (const group of groups) {
      for (const row of group.rows) this.declare(row, options, resolver);
    }
    await resolver.load();

    return groups.map((group) => {
      const ordered = [...group.rows].sort(
        (a, b) =>
          ownRowRank(a, entityName, entityUuid) -
          ownRowRank(b, entityName, entityUuid),
      );
      const lead = ordered[0];
      return {
        transactionRef: String(group.txId),
        occurredAt: isoOf(group.occurredAt),
        actor: this.actorOf(lead),
        action: lead?.action ?? null,
        summary: summarize(ordered, entityName, entityUuid),
        rows: ordered.map((row) => this.build(row, options, resolver)),
        truncated: group.truncated,
      };
    });
  }

  /** Phase one: tell the resolver every foreign key this row will present. */
  private declare(
    row: IAuditLog,
    options: AuditPresentOptions,
    resolver: FkLabelResolver,
  ): void {
    if (!options.includeDiff && !options.includeSnapshots) return;
    for (const snapshot of [row.before, row.after]) {
      if (!snapshot) continue;
      for (const [key, value] of Object.entries(snapshot)) {
        resolver.want(key, value);
      }
    }
  }

  /** Phase two, synchronous: the row as the client sees it. */
  private build(
    row: IAuditLog,
    options: AuditPresentOptions,
    resolver: FkLabelResolver,
  ): AuditRowView {
    const view: AuditRowView = {
      uuid: row.uuid ?? "",
      occurredAt: isoOf(row.occurredAt),
      entityName: row.entityName,
      entityUuid: row.entityUuid ?? null,
      entityCode: row.entityCode ?? null,
      entityDescription: row.entityDescription ?? null,
      operation: row.operation,
      action: row.action ?? null,
      source: (row.source ?? "sql") as AuditSourceValue,
      // Never `txId`, never a number — see the file header, rule 1.
      transactionRef: row.txId == null ? "" : String(row.txId),
      requestId: row.requestId ?? null,
      rootEntity: row.rootEntity ?? null,
      rootUuid: row.rootUuid ?? null,
      actor: this.actorOf(row),
      changedKeys: row.changedKeys ?? [],
    };

    if (options.includeDiff) view.diff = this.diffOf(row, resolver);
    if (options.includeSnapshots) {
      view.beforeFields = this.snapshotFields(row.before, resolver);
      view.afterFields = this.snapshotFields(row.after, resolver);
    }
    if (options.includeContext) view.context = row.context ?? null;

    return view;
  }

  /**
   * Who did it. `isSupport` is the only use of the two numeric company
   * columns and neither of them leaves; `attributed` is false for the rows P1
   * could not attribute — uploads and the six public auth routes write
   * `source='sql'` with a null `username` (§0.4) — so the UI can render
   * "Sistema" instead of a blank cell rather than the API inventing a name.
   */
  private actorOf(row: IAuditLog | undefined): AuditActor {
    const username = row?.username ?? null;
    return {
      username,
      role: row?.actorRole ?? null,
      isSupport:
        row?.actorCompanyId != null && row.actorCompanyId !== row.companyId,
      attributed: username != null,
    };
  }

  /**
   * The diff, built from **`changedKeys`** and not from `Object.keys(after)`.
   *
   * P2's trigger records a redacted column's *name* in `changedKeys` while
   * dropping its value from both snapshots (`audit-triggers.ts:241`), on
   * purpose: the event is recorded, the secret is not. Iterating `after` would
   * therefore drop the key entirely and a password change would render as an
   * empty edit — the change an auditor is most likely to be looking for,
   * invisible. Iterating `changedKeys` makes it `{key:"password",
   * redacted:true}` with no values on either side.
   *
   * `changedKeys` is NULL for `Alta` and `Baja` (the trigger only computes it
   * for an UPDATE), so those two fall back to the keys of the one snapshot they
   * have. That fallback can never hide a redaction: on an insert or a delete
   * the redacted columns are excluded from the snapshot *and* unnamed anywhere
   * on the row, so there is nothing to lose — and without it every creation
   * would present as a change to nothing.
   */
  private diffOf(row: IAuditLog, resolver: FkLabelResolver): AuditDiffEntry[] {
    const changed = row.changedKeys ?? [];
    const keys =
      changed.length > 0
        ? [...changed]
        : [
            ...new Set([
              ...Object.keys(row.before ?? {}),
              ...Object.keys(row.after ?? {}),
            ]),
          ].sort();

    return keys.map((key) => {
      const inBefore = has(row.before, key);
      const inAfter = has(row.after, key);
      if (!inBefore && !inAfter) {
        // Named but never stored: emit the event, no values on either side.
        return {
          key,
          label: key,
          before: undefined,
          after: undefined,
          redacted: true,
        };
      }
      return this.entry(
        key,
        inBefore ? (row.before as Record<string, unknown>)[key] : null,
        inAfter ? (row.after as Record<string, unknown>)[key] : null,
        resolver,
      );
    });
  }

  /** A whole snapshot in the diff's shape (`GET /:uuid`). */
  private snapshotFields(
    snapshot: Record<string, unknown> | null | undefined,
    resolver: FkLabelResolver,
  ): AuditDiffEntry[] {
    if (!snapshot) return [];
    return Object.keys(snapshot)
      .sort()
      .map((key) => this.entry(key, null, snapshot[key], resolver));
  }

  /**
   * One diff entry, with both values presented.
   *
   * `resolved` is set only when a side carried an id-shaped number, and is
   * false unless **every** such side became a label: a half-resolved entry
   * ("customerId: Acme → null") would read as "the customer was cleared", so
   * the flag reports the whole entry.
   */
  private entry(
    key: string,
    before: unknown,
    after: unknown,
    resolver: FkLabelResolver,
  ): AuditDiffEntry {
    const left = this.present(key, before, resolver);
    const right = this.present(key, after, resolver);
    const entry: AuditDiffEntry = {
      key,
      // Field labels are the SPA's job (decision Q-C1): no i18n on the server.
      label: key,
      before: left.value,
      after: right.value,
    };
    if (left.isId || right.isId)
      entry.resolved = left.resolved && right.resolved;
    return entry;
  }

  /**
   * One value. An id-shaped number becomes its label or nothing; everything
   * else passes through untouched (dates are already ISO strings inside a jsonb
   * snapshot, and null stays null — the UI renders `<Vacío>`).
   */
  private present(
    key: string,
    value: unknown,
    resolver: FkLabelResolver,
  ): { value: unknown; isId: boolean; resolved: boolean } {
    if (!isIdShaped(key, value)) {
      return { value, isId: false, resolved: true };
    }
    const label = resolver.labelFor(key, value);
    // `categoryId` and `documentId` are deliberately unmapped (two tables each
    // claim them), and a row may simply be gone by now. Either way the number
    // is withheld, never emitted.
    return { value: label ?? null, isId: true, resolved: label !== undefined };
  }
}

/** The record's own rows sort before its children, mirroring the DAO. */
const ownRowRank = (
  row: IAuditLog,
  entityName: string,
  entityUuid: string,
): number =>
  row.entityName === entityName && row.entityUuid === entityUuid ? 0 : 1;

const plural = (operation: string, count: number): string => {
  const noun = OPERATION_NOUN[operation];
  if (!noun) return `${count} ${operation}`;
  return `${count} ${count === 1 ? noun[0] : noun[1]}`;
};

/**
 * The entry's one-line summary, in Spanish, derived strictly from the rows.
 *
 * Shape: `<operación> de <tabla> (<n> campos) — <tabla hija>: <n> <operación>`,
 * e.g. `Modificación de production_routes (2 campos) — production_route_stages:
 * 1 modificación`. Table names rather than labels on purpose: labels are the
 * SPA's job (§0.2-5, no i18n on the server), and inventing a prettier noun here
 * would be detail the rows do not carry.
 */
const summarize = (
  rows: IAuditLog[],
  entityName: string,
  entityUuid: string,
): string => {
  if (rows.length === 0) return "Sin cambios";

  const own = rows.filter(
    (row) => ownRowRank(row, entityName, entityUuid) === 0,
  );
  const children = rows.filter(
    (row) => ownRowRank(row, entityName, entityUuid) === 1,
  );

  const parts: string[] = [];
  const lead = own[0];
  if (lead) {
    const phrase = OWN_ROW_PHRASE[lead.operation] ?? lead.operation;
    const fields = lead.changedKeys?.length ?? 0;
    parts.push(
      fields > 0
        ? `${phrase} ${entityName} (${fields} ${fields === 1 ? "campo" : "campos"})`
        : `${phrase} ${entityName}`,
    );
  }

  const counts = new Map<string, number>();
  for (const row of children) {
    const key = `${row.entityName} ${row.operation}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const childParts = [...counts.entries()].map(([key, count]) => {
    const [table, operation] = key.split(" ");
    return `${table}: ${plural(operation, count)}`;
  });
  if (childParts.length > 0) parts.push(childParts.join(", "));

  return parts.join(" — ");
};
