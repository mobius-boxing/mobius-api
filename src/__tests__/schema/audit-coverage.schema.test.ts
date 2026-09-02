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
  AUDIT_FK_TABLE,
  AUDIT_NO_UUID,
  AUDIT_PARENT,
  AUDIT_REDACT,
  auditDbFor,
  auditedTablesOf,
  ENTITY_READ_PERMISSION,
} from "../../database/audit-coverage";
import {
  MOBIUS_ADDED_PERMISSIONS,
  PERMISSION_CONCEPTS,
} from "../../common/constants/permissions-catalog";

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

/** R-1: 43 of the 74 audited tables are `requireAdmin()`-gated on their own routes. */
const ADMIN_ONLY_ENTITIES = 43;

/**
 * Column names the live schema points at two different tables (R-4). They must
 * stay OUT of `AUDIT_FK_TABLE`: a wrong label is worse than no label, and the
 * presenter already has a `resolved:false` path for an absent column.
 */
const AMBIGUOUS_FK_COLUMNS = ["categoryId", "documentId"];

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

describe("audit read manifest (AC-9)", () => {
  const catalogueCodes = new Set(
    [...PERMISSION_CONCEPTS, ...MOBIUS_ADDED_PERMISSIONS].map(
      (concept) => concept.code,
    ),
  );

  it("gives every audited table an ENTITY_READ_PERMISSION entry", () => {
    // Completeness is the whole point: T5 reads this map to gate the history
    // endpoint, and a missing key would silently become "no gate configured".
    expect(sorted(Object.keys(ENTITY_READ_PERMISSION))).toEqual(
      sorted(new Set(allAudited())),
    );
  });

  it("maps every non-null entry to a real catalogue code", () => {
    const unknown = sorted(
      new Set(
        Object.values(ENTITY_READ_PERMISSION).filter(
          (code): code is string => code !== null && !catalogueCodes.has(code),
        ),
      ),
    );
    expect(unknown).toEqual([]);
  });

  it("leaves exactly the admin-gated entities null", () => {
    const nulls = Object.values(ENTITY_READ_PERMISSION).filter(
      (code) => code === null,
    );
    expect(nulls).toHaveLength(ADMIN_ONLY_ENTITIES);
    // A map that went all-null would pass every other assertion here while
    // making P4's history drawer admin-only on all 74 entities (R-1 option b).
    expect(nulls.length).toBeLessThan(
      Object.keys(ENTITY_READ_PERMISSION).length,
    );
  });

  it("gives a child table the same code as its AUDIT_PARENT parent", () => {
    for (const [child, entry] of Object.entries(AUDIT_PARENT)) {
      expect({ child, code: ENTITY_READ_PERMISSION[child] }).toEqual({
        child,
        code: ENTITY_READ_PERMISSION[entry.parent],
      });
    }
  });

  it("lists only known, uuid-less application tables in AUDIT_NO_UUID", () => {
    expect(AUDIT_NO_UUID.size).toBeGreaterThan(0);
    for (const table of AUDIT_NO_UUID) {
      expect({ table, owner: DOMAIN_OWNER[table] !== undefined }).toEqual({
        table,
        owner: true,
      });
    }
  });

  it("names known tables in AUDIT_FK_TABLE and omits the ambiguous columns", () => {
    expect(Object.keys(AUDIT_FK_TABLE).length).toBeGreaterThan(0);
    const unknown = sorted(
      new Set(
        Object.values(AUDIT_FK_TABLE).filter(
          (table) => DOMAIN_OWNER[table] === undefined,
        ),
      ),
    );
    expect(unknown).toEqual([]);
    for (const column of AMBIGUOUS_FK_COLUMNS) {
      expect({ column, mapped: column in AUDIT_FK_TABLE }).toEqual({
        column,
        mapped: false,
      });
    }
  });

  it("chooses the owning database for a read, and erp otherwise", () => {
    expect(auditDbFor("countdown_documents")).toBe("countdown");
    expect(auditDbFor("nf_workflows")).toBe("nodefiles");
    expect(auditDbFor("parts")).toBe("erp");
    expect(auditDbFor(undefined)).toBe("erp");
    // `files` is fanned out across three keys, so `ownerOf` declines to answer.
    expect(auditDbFor("files")).toBe("erp");
    expect(auditDbFor("not_a_table")).toBe("erp");
  });
});

describeIfLocalDb("audit coverage vs the live schema (AC-2)", () => {
  let client: Client;
  let liveTables: string[] = [];
  const liveColumns = new Set<string>();
  /** `<column>\t<referenced table>` for every FK constraint in the schema. */
  const liveForeignKeys = new Set<string>();
  /** How many different tables each FK column name points at. */
  const fkTargetsByColumn = new Map<string, Set<string>>();

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
    // R-4's seeding query, verbatim: the map is asserted against the same
    // introspection it was generated from, so a renamed or re-pointed FK fails
    // here instead of mislabelling a diff in production.
    const foreignKeys = await client.query<{
      column_name: string;
      table_name: string;
    }>(
      `SELECT kcu.column_name, ccu.table_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu USING (constraint_name)
         JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
        WHERE tc.constraint_type = 'FOREIGN KEY'
        GROUP BY 1, 2 ORDER BY 1`,
    );
    for (const row of foreignKeys.rows) {
      liveForeignKeys.add(`${row.column_name}\t${row.table_name}`);
      const targets =
        fkTargetsByColumn.get(row.column_name) ?? new Set<string>();
      targets.add(row.table_name);
      fkTargetsByColumn.set(row.column_name, targets);
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

  it("points every AUDIT_FK_TABLE entry at the table its FK really names", () => {
    const broken: string[] = [];
    for (const [column, table] of Object.entries(AUDIT_FK_TABLE)) {
      if (!liveTables.includes(table)) {
        broken.push(`table ${table}`);
        continue;
      }
      if (!liveForeignKeys.has(`${column}\t${table}`)) {
        broken.push(`fk ${column} -> ${table}`);
      }
    }
    expect(sorted(new Set(broken))).toEqual([]);
  });

  it("maps no column the live schema points at two tables", () => {
    const ambiguous = sorted(
      Object.keys(AUDIT_FK_TABLE).filter(
        (column) => (fkTargetsByColumn.get(column)?.size ?? 0) > 1,
      ),
    );
    expect(ambiguous).toEqual([]);
  });

  it("matches information_schema exactly in AUDIT_NO_UUID", () => {
    // Both directions: a table in the set that *does* have a uuid would 400 a
    // reachable history (R-5), and one outside it that has none would return an
    // always-empty 200 instead.
    const uuidLess = sorted(
      liveTables.filter(
        (table) =>
          DOMAIN_OWNER[table] !== undefined &&
          !liveColumns.has(`${table}.uuid`),
      ),
    );
    expect(uuidLess).toEqual(sorted(AUDIT_NO_UUID));
  });
});
