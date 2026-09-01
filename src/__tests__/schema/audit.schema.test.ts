/**
 * AC-6 / AC-7 — the audit ledger and its triggers, against the live database.
 *
 * The companion of `audit-coverage.schema.test.ts`: that suite checks the
 * *manifest* (and that every parent fk and redacted column is a real column);
 * this one checks that the migration actually **installed** what the manifest
 * describes. A table can be perfectly listed in `audit-coverage.ts` and carry
 * no trigger at all — that is exactly the failure this file exists to catch, so
 * it enumerates `information_schema.triggers` and compares, table by table.
 *
 * The whole suite needs a database (`.env` points at the deployed host by
 * default), so it is guarded to `localhost` with the
 * `ownership.schema.test.ts:18-20` pattern and skips everywhere else. Run it
 * from `repos/mobius-api` with the full connection env:
 *
 *   set -a; . ./.env; set +a; SQL_HOST=localhost \
 *   npx jest src/__tests__/schema/audit.schema.test.ts
 *
 * It reads and never writes: no ledger row is created, so it needs no cleanup
 * (L-013).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { DB_KEYS } from "../../database/keys";
import {
  AUDIT_PARENT,
  AUDIT_REDACT,
  auditedTablesOf,
} from "../../database/audit-coverage";
import { AUDIT_TRIGGER_NAME } from "../../database/audit-triggers";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** §0.4: 74 distinct physical tables carry `audit_row_change`. */
const AUDITED_TABLES = 74;

/**
 * The migration creates the current month plus 13 ahead, so the inventory can
 * only shrink with time — a run 13 months from now must still find today
 * covered and the default partition empty. Asserting "today forward" rather
 * than a fixed count is what makes this suite honest as it ages.
 */
const MONTHS_AHEAD_REQUIRED = 12;

/** Every column the v2 ledger must have, and nothing else (§P2.2). */
const V2_COLUMNS = [
  "action",
  "actorCompanyId",
  "actorRole",
  "after",
  "before",
  "changedKeys",
  "companyId",
  "context",
  "createdAt",
  "entityCode",
  "entityDescription",
  "entityId",
  "entityLegacyId",
  "entityName",
  "entityUuid",
  "id",
  "legacyId",
  "occurredAt",
  "operation",
  "requestId",
  "rootEntity",
  "rootUuid",
  "source",
  "txId",
  "userId",
  "username",
  "uuid",
];

const sorted = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => a.localeCompare(b));

const allAudited = (): string[] =>
  sorted(new Set(DB_KEYS.flatMap((key) => auditedTablesOf(key))));

/** `YYYY-MM` of `date`, in UTC — the partitions are cut on UTC boundaries. */
const monthKey = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

describeIfLocalDb("audit triggers vs the live schema (AC-7)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  const triggeredTables = async (): Promise<string[]> => {
    const result = await client.query<{ event_object_table: string }>(
      `SELECT DISTINCT event_object_table FROM information_schema.triggers
        WHERE trigger_schema = 'public' AND trigger_name = $1
        ORDER BY event_object_table`,
      [AUDIT_TRIGGER_NAME],
    );
    return result.rows.map((row) => row.event_object_table);
  };

  it("has installed audit_row_change on every audited table, and only those", async () => {
    const live = await triggeredTables();
    const manifest = allAudited();

    // Named both ways round: a missing table says which one nobody attached,
    // an extra one says which table is audited without being declared.
    const missing = manifest.filter((table) => !live.includes(table));
    const unexpected = live.filter((table) => !manifest.includes(table));

    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] });
    expect(live).toHaveLength(AUDITED_TABLES);
  });

  it("fires on INSERT, UPDATE and DELETE, per row, after the write", async () => {
    const result = await client.query<{
      event_object_table: string;
      events: string;
      orientation: string;
      timing: string;
    }>(
      `SELECT event_object_table,
              string_agg(DISTINCT event_manipulation, ',' ORDER BY event_manipulation) AS events,
              min(action_orientation) AS orientation,
              min(action_timing) AS timing
         FROM information_schema.triggers
        WHERE trigger_schema = 'public' AND trigger_name = $1
        GROUP BY event_object_table`,
      [AUDIT_TRIGGER_NAME],
    );
    const wrong = result.rows.filter(
      (row) =>
        row.events !== "DELETE,INSERT,UPDATE" ||
        row.orientation !== "ROW" ||
        row.timing !== "AFTER",
    );
    expect(wrong).toEqual([]);
  });

  it("passes each table its own redaction list and parent, as trigger arguments", async () => {
    const result = await client.query<{ table_name: string; args: string }>(
      `SELECT c.relname AS table_name,
              encode(t.tgargs, 'escape') AS args
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND t.tgname = $1 AND NOT t.tgisinternal`,
      [AUDIT_TRIGGER_NAME],
    );
    // `tgargs` is NUL-separated and NUL-terminated.
    const argsOf = (row: { args: string }): string[] =>
      row.args.split("\\000").slice(0, 5);

    const wrong: string[] = [];
    for (const row of result.rows) {
      const [exclude, parent, fk, grand, grandFk] = argsOf(row);
      const expectedExclude = (AUDIT_REDACT[row.table_name] ?? []).join(",");
      const expectedParent = AUDIT_PARENT[row.table_name];
      if (exclude !== expectedExclude) wrong.push(`${row.table_name}.exclude`);
      if (parent !== (expectedParent?.parent ?? "")) {
        wrong.push(`${row.table_name}.parent`);
      }
      if (fk !== (expectedParent?.fk ?? "")) wrong.push(`${row.table_name}.fk`);
      if (grand !== (expectedParent?.grand ?? "")) {
        wrong.push(`${row.table_name}.grand`);
      }
      if (grandFk !== (expectedParent?.grandFk ?? "")) {
        wrong.push(`${row.table_name}.grandFk`);
      }
    }
    expect(sorted(wrong)).toEqual([]);
  });

  it("has both plpgsql functions in public", async () => {
    const result = await client.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('audit_row_change', 'audit_logs_protect')
        ORDER BY p.proname`,
    );
    expect(result.rows.map((row) => row.proname)).toEqual([
      "audit_logs_protect",
      "audit_row_change",
    ]);
  });

  it("protects the ledger with audit_logs_protect, before UPDATE and DELETE", async () => {
    const result = await client.query<{
      events: string;
      timing: string;
      orientation: string;
    }>(
      `SELECT string_agg(DISTINCT event_manipulation, ',' ORDER BY event_manipulation) AS events,
              min(action_timing) AS timing,
              min(action_orientation) AS orientation
         FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND trigger_name = 'audit_logs_protect'
          AND event_object_table = 'audit_logs'`,
    );
    expect(result.rows[0]).toEqual({
      events: "DELETE,UPDATE",
      timing: "BEFORE",
      orientation: "ROW",
    });
  });
});

describeIfLocalDb("the audit_logs ledger itself (AC-6)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("is partitioned by range on occurredAt", async () => {
    const result = await client.query<{ partkey: string }>(
      `SELECT pg_get_partkeydef(partrelid) AS partkey
         FROM pg_partitioned_table
        WHERE partrelid = 'public.audit_logs'::regclass`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].partkey).toBe('RANGE ("occurredAt")');
  });

  it("carries the v2 column set and nothing from v1", async () => {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_logs'
        ORDER BY column_name`,
    );
    const columns = result.rows.map((row) => row.column_name);
    expect(sorted(columns)).toEqual(sorted(V2_COLUMNS));
    // v1's single column, and the reason this migration cannot be split from
    // the deletion of the application audit path: nothing may still write it.
    expect(columns).not.toContain("snapshot");
  });

  it("has no foreign key (ruling R-B)", async () => {
    // An FK on `companyId` would have to be dropped from three of four
    // databases at the split's cutover; one on `userId` with ON DELETE SET NULL
    // would REWRITE an append-only ledger when a user is deleted.
    const result = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.audit_logs'::regclass AND contype = 'f'`,
    );
    expect(result.rows).toEqual([]);
  });

  it("has a DEFAULT partition and monthly partitions covering today forward", async () => {
    const result = await client.query<{ relname: string; isdefault: boolean }>(
      `SELECT c.relname,
              pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT' AS isdefault
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'public.audit_logs'::regclass`,
    );
    const names = result.rows.map((row) => row.relname);
    expect(result.rows.filter((row) => row.isdefault)).toHaveLength(1);

    const now = new Date();
    for (let i = 0; i <= MONTHS_AHEAD_REQUIRED; i += 1) {
      const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1),
      );
      expect(names).toContain(
        `audit_logs_y${monthKey(month).slice(0, 4)}m${monthKey(month).slice(4)}`,
      );
    }
  });

  it("keeps the DEFAULT partition empty", async () => {
    // A single row in `audit_logs_default` whose `occurredAt` falls in month M
    // permanently blocks creating M's partition (§0.3-11), so an empty default
    // is not tidiness — it is what keeps the next partition creatable.
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.audit_logs_default`,
    );
    expect(result.rows[0].count).toBe("0");
  });
});
