/**
 * AC-1 / AC-2 — the ownership manifest against the live schema.
 *
 * The manifest-only assertions always run. The `information_schema` comparison
 * and `crossPlaneRefs` (db-per-company AC-15) need a database, and there is no local dev database by default (`.env` points
 * at the deployed `traffic-postgres`), so it is guarded to `localhost` and skips
 * everywhere else (plan R-6). Run it with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=$USER SQL_PASSWORD= \
 *   SQL_DATABASE=mobius_split_scratch \
 *   npx jest src/__tests__/schema/ownership.schema.test.ts
 */
import { describe, it, expect } from "@jest/globals";
import { Client } from "pg";
import { knex as createKnex } from "knex";
import { DB_KEYS, DbKey } from "../../database/keys";
import {
  DOMAIN_OWNER,
  EXTRA_COPIES,
  TABLE_MODULE,
  TABLE_OWNER,
  ownerOf,
  tablesOf,
} from "../../database/ownership";
import { crossPlaneRefs } from "../../database/cross-plane-refs";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/**
 * D-5, frozen by measurement on the live host 2026-08-13, less the 5 store
 * tables deleted with the store module on 2026-08-24 (amendment-2026-08-24),
 * plus the 6 `nf_*` tables of node-files Phases 1 and 2.
 */
const DOMAIN_TABLE_COUNT = 81;
/** db-per-company model D-3: the pre-fan-out names, per plane. */
const DOMAIN_COUNTS: Record<DbKey, number> = {
  core: 11,
  tenant: 70,
};
/** The names each plane holds, fan-out copies included (model placement table). */
const PLANE_TABLE_COUNTS: Record<DbKey, number> = {
  core: 11,
  tenant: 72,
};
/**
 * The two names that deliberately live in both planes (AC-2, model D-5/D-6):
 * company logos vs. attachments, and one ledger per database.
 */
const FANNED_OUT_COPIES: Record<string, number> = { files: 2, audit_logs: 2 };
/** Tenant tables per catalogue slug: ERP 55 + `files` + `audit_logs` under core. */
const MODULE_COUNTS: Record<string, number> = {
  core: 57,
  countdown: 9,
  "node-files": 6,
};

const countBy = (owners: DbKey[]): Record<string, number> =>
  owners.reduce<Record<string, number>>(
    (acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }),
    {},
  );

describe("TABLE_OWNER manifest (AC-1 a/b/d, AC-2)", () => {
  it("assigns every domain table to a known key, with no key collapsed by a duplicate", () => {
    // A duplicated literal key would silently collapse, so the count is the
    // duplicate check: 81 names in, 81 names out.
    expect(Object.keys(DOMAIN_OWNER)).toHaveLength(DOMAIN_TABLE_COUNT);
    for (const [table, owner] of Object.entries(DOMAIN_OWNER)) {
      expect(DB_KEYS).toContain(owner);
      expect(table).not.toMatch(/^knex_migrations/);
    }
  });

  it("matches D-5's per-database counts", () => {
    expect(countBy(Object.values(DOMAIN_OWNER))).toEqual(DOMAIN_COUNTS);
    const total = Object.values(DOMAIN_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(DOMAIN_TABLE_COUNT);
  });

  it("keys the manifest by (database, table) so the fan-out is representable", () => {
    const extraCopies = Object.values(FANNED_OUT_COPIES).reduce(
      (sum, copies) => sum + copies - 1,
      0,
    );
    expect(Object.keys(TABLE_OWNER)).toHaveLength(
      DOMAIN_TABLE_COUNT + extraCopies,
    );

    for (const [entry, owner] of Object.entries(TABLE_OWNER)) {
      expect(entry.startsWith(`${owner}.`)).toBe(true);
      expect(DB_KEYS).toContain(owner);
    }

    for (const [table, copies] of Object.entries(FANNED_OUT_COPIES)) {
      const entries = Object.keys(TABLE_OWNER).filter((entry) =>
        entry.endsWith(`.${table}`),
      );
      expect(entries).toHaveLength(copies);
    }
  });

  it("holds 11 central and 72 tenant names, copies included (AC-15)", () => {
    const counts = Object.fromEntries(
      DB_KEYS.map((key) => [key, tablesOf(key).length]),
    );
    expect(counts).toEqual(PLANE_TABLE_COUNTS);
    expect(EXTRA_COPIES).toStrictEqual({
      files: ["tenant"],
      audit_logs: ["tenant"],
    });
  });

  it("gives every tenant table exactly one module, and nothing else one (AC-15)", () => {
    const sorted = (names: string[]): string[] =>
      [...names].sort((a, b) => a.localeCompare(b));
    expect(sorted(Object.keys(TABLE_MODULE))).toEqual(
      sorted(tablesOf("tenant")),
    );
    const perModule = Object.values(TABLE_MODULE).reduce<
      Record<string, number>
    >((acc, slug) => ({ ...acc, [slug]: (acc[slug] ?? 0) + 1 }), {});
    expect(perModule).toEqual(MODULE_COUNTS);
    expect(TABLE_MODULE.countdown_documents).toBe("countdown");
    expect(TABLE_MODULE.nf_runs).toBe("node-files");
    expect(TABLE_MODULE.products).toBe("core");
  });

  it("resolves a single-owner table and declines to guess a fanned-out one", () => {
    expect(ownerOf("customers")).toBe("tenant");
    expect(ownerOf("companies")).toBe("core");
    expect(ownerOf("countdown_documents")).toBe("tenant");
    expect(ownerOf("nf_runs")).toBe("tenant");
    expect(ownerOf("nf_node_runs")).toBe("tenant");
    // `undefined` is what stops the wrong-database guard objecting to a table
    // that legitimately exists on more than one connection.
    expect(ownerOf("files")).toBeUndefined();
    expect(ownerOf("audit_logs")).toBeUndefined();
    expect(ownerOf("knex_migrations")).toBeUndefined();
  });
});

describeIfLocalDb("TABLE_OWNER vs the live schema (AC-1 c)", () => {
  const readTables = async (): Promise<string[]> => {
    const client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
    try {
      // `pg_class`, not `information_schema.tables`: since the audit P2
      // cutover `audit_logs` is partitioned, and every monthly partition is a
      // BASE TABLE. A partition is storage for a table already in the manifest,
      // not a table of its own — `relispartition` is what says so. `relkind`
      // keeps both ordinary tables ('r') and partitioned parents ('p').
      const result = await client.query<{ table_name: string }>(
        `SELECT c.relname AS table_name
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
            AND NOT c.relispartition
            AND c.relname NOT IN ('knex_migrations', 'knex_migrations_lock')
          ORDER BY c.relname`,
      );
      return result.rows.map((row) => row.table_name);
    } finally {
      await client.end();
    }
  };

  it("has an entry for every live table and a live table for every entry", async () => {
    const live = await readTables();
    const manifest = Object.keys(DOMAIN_OWNER).sort();

    const unassigned = live.filter((table) => !(table in DOMAIN_OWNER));
    const missing = manifest.filter((table) => !live.includes(table));

    expect({ unassigned, missing }).toEqual({ unassigned: [], missing: [] });
    expect(live).toHaveLength(DOMAIN_TABLE_COUNT);
  });
});

describeIfLocalDb("crossPlaneRefs vs the live catalogue (AC-15)", () => {
  const connection = {
    host: process.env.SQL_HOST,
    port: Number(process.env.SQL_PORT) || 5432,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DATABASE,
  };

  type Ref = {
    table: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
    deleteRule: string;
    nullable: boolean;
  };
  const render = (ref: Ref): string =>
    `${ref.table}.${ref.column} -> ${ref.referencedTable}.${ref.referencedColumn} ` +
    `${ref.deleteRule} ${ref.nullable ? "NULL" : "NOT NULL"}`;

  /**
   * The same question asked a second way — `information_schema` instead of
   * `pg_constraint` — and filtered in JS instead of SQL, so a wrong join or
   * plane filter in `crossPlaneRefs` cannot agree with it by construction.
   */
  const readFromInformationSchema = async (): Promise<string[]> => {
    const client = new Client(connection);
    await client.connect();
    try {
      const result = await client.query<
        Omit<Ref, "nullable"> & { nullableText: string }
      >(
        `SELECT kcu.table_name AS "table",
                kcu.column_name AS "column",
                target.table_name AS "referencedTable",
                target.column_name AS "referencedColumn",
                rc.delete_rule AS "deleteRule",
                col.is_nullable AS "nullableText"
           FROM information_schema.referential_constraints rc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_schema = rc.constraint_schema
            AND kcu.constraint_name = rc.constraint_name
           JOIN information_schema.key_column_usage target
             ON target.constraint_schema = rc.unique_constraint_schema
            AND target.constraint_name = rc.unique_constraint_name
            AND target.ordinal_position = kcu.position_in_unique_constraint
           JOIN information_schema.columns col
             ON col.table_schema = kcu.table_schema
            AND col.table_name = kcu.table_name
            AND col.column_name = kcu.column_name
          WHERE rc.constraint_schema = 'public'`,
      );
      const tenant = new Set(tablesOf("tenant"));
      const centralOnly = new Set(
        tablesOf("core").filter((table) => !tenant.has(table)),
      );
      return result.rows
        .filter(
          (row) => tenant.has(row.table) && centralOnly.has(row.referencedTable),
        )
        .map((row) => render({ ...row, nullable: row.nullableText === "YES" }))
        .sort();
    } finally {
      await client.end();
    }
  };

  it("returns every FK from a tenant table to a central-only table, and nothing else", async () => {
    const knex = createKnex({ client: "pg", connection });
    try {
      const refs = await crossPlaneRefs(knex);
      const expected = await readFromInformationSchema();

      expect(refs.length).toBeGreaterThan(0);
      expect(refs.map(render).sort()).toEqual(expected);
      for (const ref of refs) {
        expect(tablesOf("tenant")).toContain(ref.table);
        expect(tablesOf("tenant")).not.toContain(ref.referencedTable);
        expect(ref.constraintName).toEqual(expect.any(String));
      }
    } finally {
      await knex.destroy();
    }
  });
});
