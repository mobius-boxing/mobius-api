/**
 * AC-1 / AC-2 — the audit coverage manifest, against itself and against the
 * live schema.
 *
 * This suite is the mechanism that keeps audit coverage a property of the
 * schema: a table that is neither audited nor explicitly excluded fails here,
 * and a redaction rule or parent fk naming a column that has since been renamed
 * fails here too (a renamed column silently stops redacting; a wrong fk makes
 * the trigger throw `column does not exist` on every write of that table).
 *
 * The manifest-only assertions always run. The `information_schema` half needs
 * a database — `.env` points at the deployed host by default — so it is guarded
 * to `localhost` (the `ownership.schema.test.ts:18-20` pattern) and skips
 * everywhere else. Run it from `repos/mobius-api` with the full connection env:
 *
 *   set -a; . ./.env; set +a; SQL_HOST=localhost \
 *   npx jest src/__tests__/schema/audit-coverage.schema.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { DB_KEYS, DbKey } from "../../database/keys";
import { DOMAIN_OWNER, TABLE_OWNER } from "../../database/ownership";
import {
  AUDIT_EXCLUDED,
  AUDIT_PARENT,
  AUDIT_REDACT,
  auditedTablesOf,
} from "../../database/audit-coverage";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** Verified against the live database 2026-09-01 (brief §0.4). */
const AUDITED_COUNTS: Record<DbKey, number> = {
  erp: 55,
  core: 9,
  countdown: 7,
  nodefiles: 5,
};
/** `files` is attached under core + erp + countdown: 76 calls, 74 tables. */
const ATTACH_CALLS = 76;
const AUDITED_TABLES = 74;

/** knex's own bookkeeping: excluded, and absent from `DOMAIN_OWNER`. */
const KNEX_TABLES = ["knex_migrations", "knex_migrations_lock"];

/** The 7 application tables that are deliberately not audited. */
const APPLICATION_EXCLUSIONS = [
  "audit_logs",
  "code_sequences",
  "countdown_reminder_digests",
  "countdown_reminder_log",
  "countdown_reminder_runs",
  "emailTokens",
  "nf_node_runs",
];

const allAudited = (): string[] =>
  DB_KEYS.flatMap((key) => auditedTablesOf(key));

const sorted = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => a.localeCompare(b));

describe("audit coverage manifest (AC-1)", () => {
  it("audits the expected number of tables per key", () => {
    const counts = DB_KEYS.reduce<Record<string, number>>(
      (acc, key) => ({ ...acc, [key]: auditedTablesOf(key).length }),
      {},
    );
    expect(counts).toEqual(AUDITED_COUNTS);
  });

  it("makes 76 attach calls over 74 distinct tables", () => {
    const entries = allAudited();
    expect(entries).toHaveLength(ATTACH_CALLS);
    expect(new Set(entries).size).toBe(AUDITED_TABLES);
    // The only name that fans out is `files` (core + erp + countdown).
    const fannedOut = sorted(
      new Set(entries.filter((t, i) => entries.indexOf(t) !== i)),
    );
    expect(fannedOut).toEqual(["files"]);
  });

  it("excludes exactly the 7 application tables plus knex's two", () => {
    const excluded = sorted(AUDIT_EXCLUDED);
    expect(excluded).toEqual(
      sorted([...APPLICATION_EXCLUSIONS, ...KNEX_TABLES]),
    );
    for (const table of APPLICATION_EXCLUSIONS) {
      expect(DOMAIN_OWNER[table]).toBeDefined();
    }
    for (const table of KNEX_TABLES) {
      expect(DOMAIN_OWNER[table]).toBeUndefined();
    }
  });

  it("never lists a table as both audited and excluded", () => {
    const both = sorted(
      new Set(allAudited().filter((t) => AUDIT_EXCLUDED.has(t))),
    );
    expect(both).toEqual([]);
  });

  it("agrees with ownership.ts for every table of every key", () => {
    for (const key of DB_KEYS) {
      const audited = auditedTablesOf(key);
      // Every audited name is a table this key actually holds…
      for (const table of audited) {
        expect(TABLE_OWNER[`${key}.${table}`]).toBe(key);
      }
      // …and nothing this key holds is silently dropped.
      const owned = Object.keys(TABLE_OWNER)
        .filter((entry) => entry.startsWith(`${key}.`))
        .map((entry) => entry.slice(key.length + 1));
      const uncovered = owned.filter(
        (table) => !AUDIT_EXCLUDED.has(table) && !audited.includes(table),
      );
      expect({ key, uncovered }).toEqual({ key, uncovered: [] });
    }
  });

  it("covers every DOMAIN_OWNER table exactly once as audited or excluded", () => {
    const audited = new Set(allAudited());
    const uncovered = Object.keys(DOMAIN_OWNER).filter(
      (table) => !audited.has(table) && !AUDIT_EXCLUDED.has(table),
    );
    expect(uncovered).toEqual([]);
    expect(audited.size + APPLICATION_EXCLUSIONS.length).toBe(
      Object.keys(DOMAIN_OWNER).length,
    );
  });

  it("names only real, audited tables in AUDIT_PARENT and AUDIT_REDACT", () => {
    const audited = new Set(allAudited());
    for (const [child, entry] of Object.entries(AUDIT_PARENT)) {
      expect(DOMAIN_OWNER[child]).toBeDefined();
      expect(audited.has(child)).toBe(true);
      expect(DOMAIN_OWNER[entry.parent]).toBeDefined();
      // A `grand` without a `grandFk` (or the reverse) would generate a trigger
      // whose two-hop lookup can never resolve.
      expect(entry.grand === undefined).toBe(entry.grandFk === undefined);
      if (entry.grand !== undefined) {
        expect(DOMAIN_OWNER[entry.grand]).toBeDefined();
      }
    }
    for (const [table, columns] of Object.entries(AUDIT_REDACT)) {
      expect(DOMAIN_OWNER[table]).toBeDefined();
      expect(audited.has(table)).toBe(true);
      expect(columns.length).toBeGreaterThan(0);
    }
  });
});

describeIfLocalDb("audit coverage vs the live schema (AC-2)", () => {
  let client: Client;
  let liveTables: string[] = [];
  const liveColumns = new Set<string>();

  beforeAll(async () => {
    client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
    // `pg_class`, not `information_schema.tables`: `audit_logs` is partitioned
    // since the P2 cutover and each monthly partition is a BASE TABLE. A
    // partition is storage for a table that is already in the manifest, so
    // `relispartition` filters them out; `relkind` keeps ordinary tables ('r')
    // and partitioned parents ('p') alike.
    const tables = await client.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT c.relispartition
        ORDER BY c.relname`,
    );
    liveTables = tables.rows.map((row) => row.table_name);
    const columns = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    for (const row of columns.rows) {
      liveColumns.add(`${row.table_name}.${row.column_name}`);
    }
  });

  afterAll(async () => {
    await client.end();
  });

  it("leaves no live table silently uncovered", () => {
    const audited = new Set(allAudited());
    const uncovered = liveTables.filter(
      (table) => !audited.has(table) && !AUDIT_EXCLUDED.has(table),
    );
    expect(uncovered).toEqual([]);
    expect(liveTables).toHaveLength(AUDITED_TABLES + AUDIT_EXCLUDED.size);
  });

  it("audits only tables that exist", () => {
    const missing = sorted(new Set(allAudited())).filter(
      (table) => !liveTables.includes(table),
    );
    expect(missing).toEqual([]);
  });

  it("names a real table and a real fk column in every AUDIT_PARENT entry", () => {
    const broken: string[] = [];
    for (const [child, entry] of Object.entries(AUDIT_PARENT)) {
      if (!liveTables.includes(child)) broken.push(`table ${child}`);
      if (!liveTables.includes(entry.parent)) {
        broken.push(`table ${entry.parent}`);
      }
      if (!liveColumns.has(`${child}.${entry.fk}`)) {
        broken.push(`column ${child}.${entry.fk}`);
      }
      if (entry.grand !== undefined && !liveTables.includes(entry.grand)) {
        broken.push(`table ${entry.grand}`);
      }
      if (
        entry.grandFk !== undefined &&
        !liveColumns.has(`${entry.parent}.${entry.grandFk}`)
      ) {
        broken.push(`column ${entry.parent}.${entry.grandFk}`);
      }
    }
    expect(sorted(new Set(broken))).toEqual([]);
  });

  it("redacts only columns that exist", () => {
    const missing: string[] = [];
    for (const [table, columns] of Object.entries(AUDIT_REDACT)) {
      for (const column of columns) {
        if (!liveColumns.has(`${table}.${column}`)) {
          missing.push(`${table}.${column}`);
        }
      }
    }
    expect(sorted(missing)).toEqual([]);
  });
});
