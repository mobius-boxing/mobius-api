/**
 * AC-23 (db-per-company T4) — `modules-sync` against a real catalogue.
 *
 *   1. two runs over the shipped manifests change nothing: the
 *      `(slug,name,description,isCore,updatedAt)` checksum, `company_modules`,
 *      `publicDomainLabel` and the permission tables stay as they were;
 *   2. a new manifest is inserted once, a changed one updated once, and never
 *      its `publicDomainLabel`;
 *   3. a catalogue row without a manifest is a WARNING and nothing else.
 *
 * Run from `repos/mobius-api` against a scratch copy of local
 * `traffic_production` (it writes a throwaway module row):
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=mobius_t4_rehearsal \
 *   npx jest --runInBand src/__tests__/db/modules-sync.db.test.ts
 *
 * L-013: the throwaway module and its ledger rows are deleted by slug and uuid
 * under the maintenance door, then every public table's count is compared.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { MODULE_MANIFESTS } from "../../modules/registry";
import type { ModuleCatalogueEntry } from "../../modules/module.types";
import { runModulesSync } from "../../scripts/modules-sync";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);
const DEMO_SLUG = `zz-jest-sync-${RUN}`;
const DEMO_LABEL = `zz-jest-label-${RUN}`;

type Row = Record<string, unknown>;
const rows = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> =>
  ((await db("core").raw(sql, bindings)) as { rows: T[] }).rows;

const single = async (sql: string): Promise<string> =>
  String(Object.values((await rows(sql))[0] ?? {})[0]);

const countAllTables = async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const tables = await rows<{ t: string }>(
    `select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  for (const { t } of tables) {
    counts[t] =
      (await rows<{ n: number }>(`select count(*)::int as n from ??`, [t]))[0]
        ?.n ?? 0;
  }
  return counts;
};

const catalogueChecksum = (): Promise<string> =>
  single(
    `select md5(string_agg(concat_ws('|', slug, name, coalesce(description, '∅'), "isCore", "updatedAt"), ',' order by slug)) from modules`,
  );

const untouchableState = async (): Promise<Record<string, string>> => ({
  labels: await single(
    `select string_agg(slug || '=' || coalesce("publicDomainLabel", '∅'), ',' order by slug) from modules`,
  ),
  companyModules: await single(
    `select md5(coalesce(string_agg(cm::text, ',' order by cm.id), '')) from company_modules cm`,
  ),
  permissions: await single(
    `select md5(coalesce(string_agg(p::text, ',' order by p.id), '')) from permissions p`,
  ),
  rolePermissions: await single(
    `select md5(coalesce(string_agg(rp::text, ',' order by rp::text), '')) from role_permissions rp`,
  ),
});

describeIfLocalDb("modules-sync against real Postgres (AC-23)", () => {
  let startCounts: Record<string, number> = {};
  let out: string[] = [];
  let warnings: string[] = [];

  const sync = (manifests: readonly ModuleCatalogueEntry[]): Promise<number> =>
    runModulesSync({
      knex: () => db("core"),
      manifests,
      out: (line) => out.push(line),
      warn: (line) => warnings.push(line),
    });

  const demo = (description: string): ModuleCatalogueEntry => ({
    slug: DEMO_SLUG,
    name: "ZZ Jest Sync",
    description,
    isCore: false,
  });

  beforeAll(async () => {
    await connectAll();
    startCounts = await countAllTables();
  });

  afterAll(async () => {
    try {
      const [module] = await rows<{ uuid: string }>(
        `select uuid::text as uuid from modules where slug = ?`,
        [DEMO_SLUG],
      );
      await db("core").transaction(async (trx) => {
        await trx.raw("select set_config('mobius.audit_maintenance', 'on', true)");
        await trx.raw("select set_config('mobius.audit_skip', 'on', true)");
        await trx.raw(`delete from modules where slug = ?`, [DEMO_SLUG]);
        if (module) {
          await trx.raw(`delete from audit_logs where "entityUuid" = ?`, [
            module.uuid,
          ]);
        }
      });
      expect(await countAllTables()).toEqual(startCounts);
    } finally {
      await disconnectAll();
    }
  });

  it("declares a plane on every manifest", () => {
    for (const manifest of MODULE_MANIFESTS) {
      expect([manifest.slug, manifest.plane]).toEqual([manifest.slug, "tenant"]);
    }
  });

  it("changes nothing when run twice over the shipped manifests", async () => {
    const checksum = await catalogueChecksum();
    const state = await untouchableState();

    for (let run = 0; run < 2; run += 1) {
      out = [];
      warnings = [];
      expect(await sync(MODULE_MANIFESTS)).toBe(0);
      expect(out).toEqual([
        "modules-sync: inserted 0, updated 0, unchanged 3 [core, countdown, node-files], without manifest 0",
      ]);
      expect(warnings).toEqual([]);
      expect(await catalogueChecksum()).toBe(checksum);
      expect(await untouchableState()).toEqual(state);
    }
  });

  it("inserts a new manifest once, then leaves it alone", async () => {
    out = [];
    expect(await sync([...MODULE_MANIFESTS, demo("first")])).toBe(0);
    expect(out[0]).toContain(`inserted 1 [${DEMO_SLUG}]`);
    const checksum = await catalogueChecksum();

    out = [];
    expect(await sync([...MODULE_MANIFESTS, demo("first")])).toBe(0);
    expect(out[0]).toContain("inserted 0, updated 0, unchanged 4");
    expect(await catalogueChecksum()).toBe(checksum);
  });

  it("updates a changed manifest and never its publicDomainLabel", async () => {
    await rows(`update modules set "publicDomainLabel" = ? where slug = ?`, [
      DEMO_LABEL,
      DEMO_SLUG,
    ]);
    const state = await untouchableState();
    const [before] = await rows<{ updatedAt: Date }>(
      `select "updatedAt" from modules where slug = ?`,
      [DEMO_SLUG],
    );

    out = [];
    expect(await sync([...MODULE_MANIFESTS, demo("second")])).toBe(0);

    expect(out[0]).toContain(`updated 1 [${DEMO_SLUG}]`);
    const [after] = await rows<{
      description: string;
      publicDomainLabel: string;
      updatedAt: Date;
    }>(
      `select description, "publicDomainLabel", "updatedAt" from modules where slug = ?`,
      [DEMO_SLUG],
    );
    expect(after?.description).toBe("second");
    expect(after?.publicDomainLabel).toBe(DEMO_LABEL);
    expect(after?.updatedAt.getTime()).toBeGreaterThan(
      before?.updatedAt.getTime() ?? Infinity,
    );
    expect(await untouchableState()).toEqual(state);
  });

  it("warns about a catalogue row without a manifest and changes nothing", async () => {
    const checksum = await catalogueChecksum();
    const state = await untouchableState();
    const withoutNodeFiles = MODULE_MANIFESTS.filter(
      (m) => m.slug !== "node-files",
    );

    out = [];
    warnings = [];
    expect(await sync([...withoutNodeFiles, demo("second")])).toBe(0);

    expect(warnings).toEqual([
      "modules-sync: WARNING: module 'node-files' is in the catalogue but no manifest declares it; left unchanged",
    ]);
    expect(out[0]).toMatch(/without manifest 1 \[node-files\]$/);
    expect(await catalogueChecksum()).toBe(checksum);
    expect(await untouchableState()).toEqual(state);
  });
});
