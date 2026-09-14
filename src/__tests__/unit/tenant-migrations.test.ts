/**
 * I-12 / AC-29 — every tenant migration after the baseline is expand-only,
 * unless it names the expand migration it contracts. The fleet migrates BEFORE
 * the container swap (D-18), so the previous image briefly serves a schema one
 * migration ahead of it: a dropped, renamed, retyped or newly NOT NULL column
 * breaks that image mid-deploy. Static on purpose (D-56): a runtime check would
 * fire after the fleet had already migrated.
 *
 * Also here, with the migrator mocked: the migration CLIs' refusals — AC-28's
 * L-003 guard on `migrate:rollback` and `migrate:deploy`'s fleet flags, which
 * must be refused rather than ignored until the fleet exists (T9).
 */
import { describe, it, expect, jest } from "@jest/globals";
import fs from "fs";
import {
  TENANT_BASELINE_FILE,
  localOnlyRefusal,
  migrationsDirectory,
} from "../../database/migration-sets";
import { runMigrateAll } from "../../scripts/migrate-all";
import { runMigrateRollback } from "../../scripts/migrate-rollback";

type MigrationSource = { name: string; source: string };

const CONTRACT_DDL: readonly { label: string; pattern: RegExp }[] = [
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "RENAME", pattern: /\bRENAME\b/i },
  {
    label: "ALTER COLUMN … TYPE",
    pattern: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i,
  },
  { label: "SET NOT NULL", pattern: /\bSET\s+NOT\s+NULL\b/i },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  // The knex schema builder spells the same operations without SQL keywords.
  { label: "dropColumn", pattern: /\.dropColumns?\s*\(/ },
  {
    label: "renameColumn/renameTable",
    pattern: /\.rename(?:Column|Table)\s*\(/,
  },
  { label: "dropTable", pattern: /\.dropTable(?:IfExists)?\s*\(/ },
  { label: "alter()", pattern: /\.alter\s*\(/ },
  { label: "dropNullable", pattern: /\.dropNullable\s*\(/ },
];

const CONTRACT_MARKER = /\/\/\s*contract:\s*(\S+)/;

const withoutExtension = (name: string): string => name.replace(/\.ts$/, "");

function contractViolations(files: readonly MigrationSource[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.name === TENANT_BASELINE_FILE) continue;
    const found = CONTRACT_DDL.filter(({ pattern }) =>
      pattern.test(file.source),
    ).map(({ label }) => label);
    if (found.length === 0) continue;
    const marker = CONTRACT_MARKER.exec(file.source)?.[1];
    const expand = files.find(
      (candidate) =>
        marker !== undefined &&
        withoutExtension(candidate.name) === withoutExtension(marker),
    );
    if (expand === undefined || expand.name >= file.name) {
      violations.push(
        `${file.name}: ${found.join(", ")} without a "// contract: <expand-migration>" marker naming an earlier tenant migration`,
      );
    }
  }
  return violations;
}

const readTenantSet = (): MigrationSource[] =>
  fs
    .readdirSync(migrationsDirectory("tenant"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => ({
      name,
      source: fs.readFileSync(
        `${migrationsDirectory("tenant")}/${name}`,
        "utf8",
      ),
    }));

describe("tenant migrations are expand-only after the baseline (AC-29, I-12)", () => {
  it("holds the baseline first and no unmarked contract DDL", () => {
    const files = readTenantSet();
    expect(files[0]?.name).toBe(TENANT_BASELINE_FILE);
    expect(contractViolations(files)).toEqual([]);
  });

  const baseline: MigrationSource = {
    name: TENANT_BASELINE_FILE,
    source: "CREATE TABLE public.parts (id integer);",
  };

  it.each([
    ['ALTER TABLE parts DROP COLUMN "legacyId";'],
    ["ALTER TABLE parts RENAME TO parts_old;"],
    ['ALTER TABLE parts RENAME COLUMN "code" TO "number";'],
    ['ALTER TABLE parts ALTER COLUMN "code" TYPE text;'],
    ['ALTER TABLE parts\n  ALTER COLUMN "code"\n  SET DATA TYPE text;'],
    ['ALTER TABLE parts ALTER COLUMN "code" SET NOT NULL;'],
    ["DROP TABLE parts;"],
    ['await knex.schema.alterTable("parts", (t) => t.dropColumn("code"));'],
    ['await knex.schema.alterTable("parts", (t) => t.dropColumns("a", "b"));'],
    ['await knex.schema.alterTable("parts", (t) => t.renameColumn("a", "b"));'],
    ['await knex.schema.renameTable("parts", "parts_old");'],
    ['await knex.schema.dropTableIfExists("parts");'],
    ['await knex.schema.alterTable("parts", (t) => t.text("code").alter());'],
    ['await knex.schema.alterTable("parts", (t) => t.dropNullable("code"));'],
  ])("flags an unmarked contract step: %s", (statement) => {
    const migration = {
      name: "20270101000000_contract.ts",
      source: `export async function up(knex) { await knex.raw(\`${statement}\`); }`,
    };
    expect(contractViolations([baseline, migration])).toHaveLength(1);
  });

  const dropCode = (marker: string): MigrationSource => ({
    name: "20270201000000_drop_part_code.ts",
    source: `${marker}\nexport const up = 'ALTER TABLE parts DROP COLUMN "code"';`,
  });
  const expand: MigrationSource = {
    name: "20270101000000_add_part_number.ts",
    source: `export const up = 'ALTER TABLE parts ADD COLUMN "number" text';`,
  };
  const later: MigrationSource = {
    name: "20270301000000_backfill.ts",
    source: "export const up = 'UPDATE parts SET x = 1';",
  };

  it("accepts a contract step whose marker names an earlier tenant migration", () => {
    const files = [
      baseline,
      expand,
      dropCode("// contract: 20270101000000_add_part_number"),
    ];
    expect(contractViolations(files)).toEqual([]);
    const withExtension = [
      baseline,
      expand,
      dropCode("// contract: 20270101000000_add_part_number.ts"),
    ];
    expect(contractViolations(withExtension)).toEqual([]);
  });

  it("rejects a marker naming a later, unknown or itself migration, or no marker", () => {
    const cases = [
      "// contract: 20270301000000_backfill",
      "// contract: 20260101000000_not_a_tenant_migration",
      "// contract: 20270201000000_drop_part_code",
      "// contract:",
      "",
    ];
    for (const marker of cases) {
      expect({
        marker,
        violations: contractViolations([
          baseline,
          expand,
          dropCode(marker),
          later,
        ]).length,
      }).toEqual({ marker, violations: 1 });
    }
  });

  it("exempts only the baseline itself and passes expand-only migrations", () => {
    const expandOnly: MigrationSource = {
      name: "20270101000000_expand.ts",
      source:
        'await knex.schema.alterTable("parts", (t) => { t.text("number").nullable(); t.index(["number"]); });\n' +
        "await knex.raw('CREATE INDEX parts_number_idx ON parts (\"number\")');",
    };
    const lookalike: MigrationSource = {
      name: "00000000000001_baseline.ts",
      source: "DROP TABLE parts;",
    };
    expect(
      contractViolations([
        { name: TENANT_BASELINE_FILE, source: "DROP TABLE parts;" },
        expandOnly,
      ]),
    ).toEqual([]);
    expect(contractViolations([baseline, lookalike])).toHaveLength(1);
  });
});

describe("migrate:rollback refuses anything but a local database (AC-28, L-003)", () => {
  const local = { NODE_ENV: "development", SQL_HOST: "localhost" };

  it("names L-003 when the host is not local, unset, or NODE_ENV is production", () => {
    const refused = [
      { ...local, SQL_HOST: "traffic-postgres" },
      { ...local, SQL_HOST: "18.223.85.0" },
      { NODE_ENV: "development" },
      { ...local, NODE_ENV: "production" },
      { SQL_HOST: "127.0.0.1", NODE_ENV: "production" },
    ];
    for (const env of refused) {
      expect({
        env,
        refusal: localOnlyRefusal("migrate:rollback", env),
      }).toEqual({
        env,
        refusal: expect.stringContaining("L-003"),
      });
    }
    expect(localOnlyRefusal("migrate:rollback", local)).toBeUndefined();
    expect(
      localOnlyRefusal("migrate:rollback", {
        NODE_ENV: "test",
        SQL_HOST: "127.0.0.1",
      }),
    ).toBeUndefined();
  });

  it("never reaches the migrator when refused", async () => {
    const rollbackCore = jest.fn(async (): Promise<readonly string[]> => []);
    const err = jest.fn();
    const code = await runMigrateRollback([], {
      env: { NODE_ENV: "development", SQL_HOST: "traffic-postgres" },
      rollbackCore,
      out: jest.fn(),
      err,
    });
    expect(code).toBe(1);
    expect(rollbackCore).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("L-003"));
  });

  it("rolls back the core set once on a local database", async () => {
    const rollbackCore = jest.fn(
      async (): Promise<readonly string[]> => [
        "20260902000001_seed_audit_permissions.ts",
      ],
    );
    const out = jest.fn();
    const code = await runMigrateRollback([], {
      env: local,
      rollbackCore,
      out,
      err: jest.fn(),
    });
    expect(code).toBe(0);
    expect(rollbackCore).toHaveBeenCalledTimes(1);
    expect(out).toHaveBeenCalledWith(
      "[rollback] core: rolled back 1: 20260902000001_seed_audit_permissions.ts",
    );
  });
});

describe("migrate:deploy runs the core set and refuses fleet flags (AC-24, D-40)", () => {
  const deps = () => ({
    migrateCore: jest.fn(async (): Promise<readonly string[]> => []),
    out: jest.fn(),
    err: jest.fn(),
  });

  it.each([[[]], [["--core-only"]]])("migrates core for %j", async (argv) => {
    const d = deps();
    expect(await runMigrateAll(argv, d)).toBe(0);
    expect(d.migrateCore).toHaveBeenCalledTimes(1);
    expect(d.out).toHaveBeenCalledWith("[migrate] core: already up to date");
  });

  it.each([
    [["--fleet-only"]],
    [["--company", "3f0c2c52-8a7e-4f39-a0c1-1e8e2d7c4b10"]],
    [["--core-only", "--company", "3f0c2c52-8a7e-4f39-a0c1-1e8e2d7c4b10"]],
    [["--everything"]],
  ])("refuses %j without migrating anything", async (argv) => {
    const d = deps();
    expect(await runMigrateAll(argv, d)).toBe(2);
    expect(d.migrateCore).not.toHaveBeenCalled();
  });

  it("exits 1 with the reason when the core set fails", async () => {
    const d = deps();
    d.migrateCore.mockRejectedValueOnce(
      new Error("migration directory is corrupt"),
    );
    expect(await runMigrateAll([], d)).toBe(1);
    expect(d.err).toHaveBeenCalledWith(
      "[migrate] core failed: migration directory is corrupt",
    );
  });
});
