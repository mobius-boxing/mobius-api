/**
 * AC-1 / AC-2 — the ownership manifest against the live schema.
 *
 * The manifest-only assertions always run. The `information_schema` comparison
 * needs a database, and there is no local dev database by default (`.env` points
 * at the deployed `traffic-postgres`), so it is guarded to `localhost` and skips
 * everywhere else (plan R-6). Run it with, from `repos/mobius-api`:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=$USER SQL_PASSWORD= \
 *   SQL_DATABASE=mobius_split_scratch \
 *   npx jest src/__tests__/schema/ownership.schema.test.ts
 */
import { describe, it, expect } from "@jest/globals";
import { Client } from "pg";
import { DB_KEYS, DbKey } from "../../database/keys";
import { DOMAIN_OWNER, TABLE_OWNER, ownerOf } from "../../database/ownership";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

/** D-5, frozen by measurement on the live host 2026-08-13. */
const DOMAIN_TABLE_COUNT = 75;
const DOMAIN_COUNTS: Record<DbKey, number> = {
  core: 10,
  store: 5,
  countdown: 9,
  erp: 51,
};
/** The two names that deliberately live in more than one database (AC-2). */
const FANNED_OUT_COPIES: Record<string, number> = { files: 3, audit_logs: 4 };

const countBy = (owners: DbKey[]): Record<string, number> =>
  owners.reduce<Record<string, number>>(
    (acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }),
    {},
  );

describe("TABLE_OWNER manifest (AC-1 a/b/d, AC-2)", () => {
  it("assigns every domain table to a known key, with no key collapsed by a duplicate", () => {
    // A duplicated literal key would silently collapse, so the count is the
    // duplicate check: 75 names in, 75 names out.
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

  it("resolves a single-owner table and declines to guess a fanned-out one", () => {
    expect(ownerOf("customers")).toBe("erp");
    expect(ownerOf("companies")).toBe("core");
    expect(ownerOf("store_boxes")).toBe("store");
    expect(ownerOf("countdown_documents")).toBe("countdown");
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
      const result = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            AND table_name NOT IN ('knex_migrations', 'knex_migrations_lock')
          ORDER BY table_name`,
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
