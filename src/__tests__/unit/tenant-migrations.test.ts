/**
 * I-12 / AC-29 — every tenant migration after the baseline is expand-only,
 * unless it names the expand migration it contracts. The fleet migrates BEFORE
 * the container swap (D-18), so the previous image briefly serves a schema one
 * migration ahead of it: a dropped, renamed, retyped or newly NOT NULL column
 * breaks that image mid-deploy. Static on purpose (D-56): a runtime check would
 * fire after the fleet had already migrated.
 *
 * Also here, with every side effect injected: the migration CLIs' refusals —
 * AC-28's L-003 guard on `migrate:rollback`, the same guard on `db:bootstrap`
 * and the baseline generator, the generator's refusal of a source database
 * whose history is not exactly `migrations/core/`, `migrate:deploy`'s fleet
 * flags (refused rather than ignored until the fleet exists, T9), and the
 * knexfile opening no connection until knex needs one.
 */
import { describe, it, expect, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import type { Knex } from "knex";
import { MissingDatabaseNameError } from "../../database/env";
import {
  TENANT_BASELINE_FILE,
  TenantConnectionNotConfiguredError,
  knexfileConfig,
  localOnlyRefusal,
  migrationsDirectory,
  type MigrationConnection,
} from "../../database/migration-sets";
import { runMigrateAll } from "../../scripts/migrate-all";
import { runMigrateRollback } from "../../scripts/migrate-rollback";
import {
  runDbBootstrap,
  type DbBootstrapDeps,
} from "../../scripts/db-bootstrap";
import {
  coreHistoryMismatch,
  runGenerateTenantBaseline,
  type GenerateBaselineDeps,
} from "../../scripts/generate-tenant-baseline";

type MigrationSource = { name: string; source: string };

/** Keywords that follow DROP / ALTER without naming a column. */
const NOT_A_COLUMN =
  "(?:TABLE|INDEX|CONSTRAINT|TRIGGER|NOT|DEFAULT|IDENTITY|EXPRESSION)\\b";

const CONTRACT_DDL: readonly { label: string; pattern: RegExp }[] = [
  // `COLUMN` is optional in `ALTER TABLE … DROP [COLUMN] [IF EXISTS] name`.
  {
    label: "DROP [COLUMN] <column>",
    pattern: new RegExp(
      `\\bDROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(?!${NOT_A_COLUMN})"?[A-Za-z_]`,
      "i",
    ),
  },
  { label: "RENAME", pattern: /\bRENAME\b/i },
  {
    label: "ALTER COLUMN … TYPE",
    pattern: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i,
  },
  // …and in `ALTER [COLUMN] name [SET DATA] TYPE`.
  {
    label: "ALTER [COLUMN] <column> [SET DATA] TYPE",
    pattern:
      /\bALTER\s+(?:COLUMN\s+)?(?!TABLE\b)"?[A-Za-z_][A-Za-z0-9_]*"?\s+(?:SET\s+DATA\s+)?TYPE\b/i,
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

// The DDL patterns are case-insensitive and `DROP <name>` reads like English,
// so prose in a JS or SQL comment ("drop legacy rows later") would flag an
// expand-only migration — comments are stripped before matching. The marker
// is read from the unstripped source.
//
// Quote-aware, with two different quote roles rather than one: a `'…'` or
// `"…"` region is an opaque VALUE (a JS string, or one complete SQL literal)
// — nothing inside it, comment marker or nested quote, is ever examined,
// so a literal like "a//b" or '--' sitting next to real DDL cannot comment
// the DDL out. A backtick region is transparent CODE — it is where a
// migration's raw, possibly multi-line SQL lives (as pg_dump emits it), so a
// genuine `--` comment inside one is still stripped, and a nested `'…'`/`"…"`
// SQL literal inside it is still opaque. A doubled quote (the SQL `''`
// escape, which also covers a doubled JS quote) or a backslash-escaped one
// keeps a string open. This is not a real lexer — nested template `${…}`
// interpolation is not re-entered as code — but every fixture here, and
// every real migration, keeps its SQL as one unbroken string.
type Quote = "'" | '"' | "`";
const isQuote = (ch: string | undefined): ch is Quote =>
  ch === "'" || ch === '"' || ch === "`";

function scanRegion(
  source: string,
  start: number,
  terminator: Quote | null,
): { text: string; next: number } {
  // Only a single/double quote is opaque to comments and nested quotes; a
  // backtick keeps scanning as code (see the note above the caller).
  const opaque = terminator === "'" || terminator === '"';
  let out = "";
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (terminator !== null && ch === terminator) {
      if (source[i + 1] === terminator) {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      return { text: out + ch, next: i + 1 };
    }
    if (ch === "\\" && terminator !== null) {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (!opaque && isQuote(ch)) {
      const inner = scanRegion(source, i + 1, ch);
      out += ch + inner.text;
      i = inner.next;
      continue;
    }
    if (!opaque) {
      const two = source.slice(i, i + 2);
      if (two === "/*") {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (two === "//" || two === "--") {
        const end = source.indexOf("\n", i);
        i = end === -1 ? source.length : end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return { text: out, next: i };
}

const withoutComments = (source: string): string =>
  scanRegion(source, 0, null).text;

function contractViolations(files: readonly MigrationSource[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.name === TENANT_BASELINE_FILE) continue;
    const code = withoutComments(file.source);
    const found = CONTRACT_DDL.filter(({ pattern }) => pattern.test(code)).map(
      ({ label }) => label,
    );
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
    ['ALTER TABLE parts DROP "legacyId";'],
    ["ALTER TABLE parts DROP legacy_id CASCADE;"],
    ['ALTER TABLE parts DROP IF EXISTS "legacyId";'],
    ['ALTER TABLE parts DROP COLUMN IF EXISTS "legacyId";'],
    ['ALTER TABLE parts ADD COLUMN "number" text, DROP "code";'],
    ['ALTER TABLE parts ALTER "code" TYPE text;'],
    ["ALTER TABLE parts ALTER code SET DATA TYPE bigint;"],
    ['alter table parts alter column "code" type bigint using "code"::bigint;'],
    // Regression (cycle 2): a SQL `--` string literal sitting next to real
    // DDL on the same line must not comment the DDL out.
    ["UPDATE parts SET note = '--'; ALTER TABLE parts DROP COLUMN \"code\";"],
  ])("flags an unmarked contract step: %s", (statement) => {
    const migration = {
      name: "20270101000000_contract.ts",
      source: `export async function up(knex) { await knex.raw(\`${statement}\`); }`,
    };
    expect(contractViolations([baseline, migration])).toHaveLength(1);
  });

  // Regression (cycle 2): `withoutComments` used to strip a line or block
  // comment wherever its marker appeared, including inside an unrelated
  // string literal. A "--" separator, an "a//b" literal or a "migrations/star"
  // path sitting next to real DDL then commented the DDL out — or, for a
  // stray block-comment opener, commented out everything up to the far-away
  // closer, including a legitimate later comment that happened to contain
  // one. These fixtures are full migration sources (not the
  // `statement`-in-backticks wrapper above) because the quote style around
  // the DDL is the point.
  it.each([
    [
      'a JS double-quoted "--" next to a single-quoted DDL statement',
      "export async function up(knex) {\n" +
        '  const sep = "--";\n' +
        "  await knex.raw('ALTER TABLE parts DROP COLUMN code');\n" +
        "}\n",
    ],
    [
      'a "a//b" literal next to a raw DROP COLUMN',
      "export async function up(knex) {\n" +
        '  const p = "a//b";\n' +
        "  await knex.raw('ALTER TABLE parts DROP COLUMN code');\n" +
        "}\n",
    ],
    [
      'a "x//y" literal next to knex.schema.dropColumn',
      "export async function up(knex) {\n" +
        '  const p = "x//y";\n' +
        '  await knex.schema.alterTable("parts", (t) => t.dropColumn("code"));\n' +
        "}\n",
    ],
    [
      'a "migrations/*" literal with a later "// see */" comment',
      "export async function up(knex) {\n" +
        '  const dir = "migrations/*";\n' +
        "  await knex.raw('ALTER TABLE parts DROP COLUMN code');\n" +
        "  // see */ for the naming scheme\n" +
        "}\n",
    ],
    [
      "SET NOT NULL after a '--' literal",
      "export async function up(knex) {\n" +
        "  const marker = '--';\n" +
        "  await knex.raw('ALTER TABLE parts ALTER COLUMN \"code\" SET NOT NULL');\n" +
        "}\n",
    ],
    [
      "RENAME COLUMN after a '--' literal",
      "export async function up(knex) {\n" +
        "  const marker = '--';\n" +
        '  await knex.raw(\'ALTER TABLE parts RENAME COLUMN "code" TO "number"\');\n' +
        "}\n",
    ],
  ])(
    "flags real DDL hidden behind a comment-lookalike inside a string: %s",
    (_label, source) => {
      const migration = { name: "20270101000000_contract.ts", source };
      expect(contractViolations([baseline, migration])).toHaveLength(1);
    },
  );

  it.each([
    [
      "a real block comment before real DDL",
      "export async function up(knex) {\n" +
        "  /* why */ await knex.raw('ALTER TABLE parts DROP COLUMN code');\n" +
        "}\n",
    ],
    [
      "a real SQL comment line, then real DDL on the next line",
      "export async function up(knex) {\n" +
        "  // --\n" +
        "  await knex.raw('ALTER TABLE parts DROP COLUMN code');\n" +
        "}\n",
    ],
  ])("still flags real DDL next to a genuine comment: %s", (_label, source) => {
    const migration = { name: "20270101000000_contract.ts", source };
    expect(contractViolations([baseline, migration])).toHaveLength(1);
  });

  it("does not flag prose in a genuine comment that reads like DDL", () => {
    const migration = {
      name: "20270101000000_expand.ts",
      source:
        "// drop us a line if this migration behaves oddly\n" +
        "export async function up(knex) {\n" +
        "  await knex.raw('ALTER TABLE parts ADD COLUMN \"type\" text');\n" +
        "}\n",
    };
    expect(contractViolations([baseline, migration])).toEqual([]);
  });

  it.each([
    ["ALTER TABLE parts DROP CONSTRAINT parts_code_unique;"],
    ["ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_code_unique;"],
    ['ALTER TABLE parts ALTER COLUMN "code" DROP NOT NULL;'],
    ['ALTER TABLE parts ALTER "code" DROP DEFAULT;'],
    ["ALTER TABLE parts ALTER COLUMN \"code\" SET DEFAULT 'x';"],
    ["DROP INDEX IF EXISTS parts_code_index;"],
    ["DROP TRIGGER IF EXISTS audit_row_change ON public.parts;"],
    ['ALTER TABLE parts ADD COLUMN "type" text;'],
    ['ALTER TABLE parts ADD COLUMN "dropped" boolean;'],
    ["-- drop legacy rows in a later migration\nUPDATE parts SET x = 1;"],
  ])("does not flag an expand step: %s", (statement) => {
    const migration = {
      name: "20270101000000_expand.ts",
      source:
        "// We will drop legacy rows once every tenant has migrated.\n" +
        `export async function up(knex) { await knex.raw(\`${statement}\`); }`,
    };
    expect(contractViolations([baseline, migration])).toEqual([]);
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

const LOCAL_ENV = { NODE_ENV: "development", SQL_HOST: "localhost" };
const OFF_LOCAL_ENVS = [
  { NODE_ENV: "development", SQL_HOST: "traffic-postgres" },
  { NODE_ENV: "production", SQL_HOST: "localhost" },
];
const UNIT_CONNECTION: MigrationConnection = {
  host: "localhost",
  port: 5432,
  database: "zz_unit_core",
  user: "traffic_user",
  password: "unit",
  ssl: false,
};

describe("db:bootstrap runs only on a local database (W3, D-124)", () => {
  const deps = (
    env: NodeJS.ProcessEnv,
    connection: MigrationConnection = UNIT_CONNECTION,
  ) => ({
    env,
    connection: jest.fn<DbBootstrapDeps["connection"]>(() => connection),
    createDatabase: jest.fn<DbBootstrapDeps["createDatabase"]>(
      async () => true,
    ),
    migrate: jest.fn<DbBootstrapDeps["migrate"]>(async () => [
      TENANT_BASELINE_FILE,
    ]),
    out: jest.fn<(line: string) => void>(),
    err: jest.fn<(line: string) => void>(),
  });

  it.each(OFF_LOCAL_ENVS)(
    "refuses %j naming L-003, before reading arguments or connecting",
    async (env) => {
      for (const argv of [["--scratch-tenant"], ["--bogus"]]) {
        const d = deps(env);
        expect(await runDbBootstrap(argv, d)).toBe(1);
        expect(d.err).toHaveBeenCalledWith(
          expect.stringContaining("db:bootstrap refused"),
        );
        expect(d.err).toHaveBeenCalledWith(expect.stringContaining("L-003"));
        expect(d.connection).not.toHaveBeenCalled();
        expect(d.createDatabase).not.toHaveBeenCalled();
        expect(d.migrate).not.toHaveBeenCalled();
      }
    },
  );

  it("creates and migrates a named scratch tenant, printing its name last", async () => {
    const d = deps(LOCAL_ENV);
    const target = {
      set: "tenant" as const,
      database: "zz_jest_tenant_abc123",
      mustNotExist: true,
    };
    expect(
      await runDbBootstrap(["--scratch-tenant", "--run", "abc123"], d),
    ).toBe(0);
    expect(d.createDatabase).toHaveBeenCalledWith(target, UNIT_CONNECTION);
    expect(d.migrate).toHaveBeenCalledWith(target, UNIT_CONNECTION);
    expect(d.out.mock.calls[d.out.mock.calls.length - 1]).toEqual([
      "zz_jest_tenant_abc123",
    ]);
  });

  it("bootstraps SQL_DATABASE with the core set when no flag is given", async () => {
    const d = deps(LOCAL_ENV);
    expect(await runDbBootstrap([], d)).toBe(0);
    expect(d.createDatabase).toHaveBeenCalledWith(
      { set: "core", database: "zz_unit_core", mustNotExist: false },
      UNIT_CONNECTION,
    );
  });

  it.each([
    [["--run", "abc123"], UNIT_CONNECTION],
    [["--scratch-tenant", "--run", "Not-Safe"], UNIT_CONNECTION],
    [["--scratch-tenant", "--run"], UNIT_CONNECTION],
    [[], { ...UNIT_CONNECTION, database: 'core"; DROP DATABASE x; --' }],
    [["--scratch-tenant"], { ...UNIT_CONNECTION, user: 'app" SUPERUSER' }],
  ])("exits 2 without creating anything for %j", async (argv, connection) => {
    const d = deps(LOCAL_ENV, connection);
    expect(await runDbBootstrap(argv, d)).toBe(2);
    expect(d.createDatabase).not.toHaveBeenCalled();
    expect(d.migrate).not.toHaveBeenCalled();
  });

  it("rejects an unknown flag with the usage line before resolving a connection (nit)", async () => {
    const d = deps(LOCAL_ENV);
    expect(await runDbBootstrap(["--bogus"], d)).toBe(2);
    expect(d.err).toHaveBeenCalledWith(
      expect.stringContaining("unknown argument --bogus"),
    );
    expect(d.err).toHaveBeenCalledWith(
      expect.stringContaining("usage: db:bootstrap"),
    );
    expect(d.connection).not.toHaveBeenCalled();
    expect(d.createDatabase).not.toHaveBeenCalled();
    expect(d.migrate).not.toHaveBeenCalled();
  });
});

describe("generate-tenant-baseline refuses off localhost and on a foreign history (W2, W3)", () => {
  const CORE_FILES = [
    "20250922014421_create_users_table.ts",
    "20260902000001_seed_audit_permissions.ts",
  ];

  const setup = (env: NodeJS.ProcessEnv, applied: readonly string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t5-baseline-"));
    const raw = jest.fn(async () => ({
      rows: applied.map((name) => ({ name })),
    }));
    const destroy = jest.fn(async () => undefined);
    const deps = {
      env,
      openSource: jest.fn<GenerateBaselineDeps["openSource"]>(() => ({
        knex: { raw, destroy } as unknown as Knex,
        connection: UNIT_CONNECTION,
      })),
      coreMigrationFiles: () => [...CORE_FILES],
      render: jest.fn<GenerateBaselineDeps["render"]>(
        async () => "rendered baseline\n",
      ),
      baselineFile: path.join(dir, TENANT_BASELINE_FILE),
      out: jest.fn<(line: string) => void>(),
      err: jest.fn<(line: string) => void>(),
    };
    return {
      deps,
      destroy,
      cleanup: () => fs.rmSync(dir, { recursive: true }),
    };
  };

  it.each(OFF_LOCAL_ENVS)(
    "refuses %j naming L-003 without opening the source",
    async (env) => {
      const { deps, cleanup } = setup(env, CORE_FILES);
      try {
        expect(await runGenerateTenantBaseline([], deps)).toBe(1);
        expect(deps.err).toHaveBeenCalledWith(expect.stringContaining("L-003"));
        expect(deps.openSource).not.toHaveBeenCalled();
        expect(deps.render).not.toHaveBeenCalled();
        expect(fs.existsSync(deps.baselineFile)).toBe(false);
      } finally {
        cleanup();
      }
    },
  );

  it.each([
    [
      [CORE_FILES[0]],
      "not applied: [20260902000001_seed_audit_permissions.ts]",
    ],
    [
      [...CORE_FILES, "20260912120000_create_user_devices_table.ts"],
      "not in migrations/core: [20260912120000_create_user_devices_table.ts]",
    ],
    [
      [],
      "not applied: [20250922014421_create_users_table.ts, 20260902000001_seed_audit_permissions.ts]",
    ],
  ])(
    "refuses a source database whose history is %j, naming the difference",
    async (applied, difference) => {
      const { deps, destroy, cleanup } = setup(LOCAL_ENV, applied);
      try {
        expect(await runGenerateTenantBaseline([], deps)).toBe(1);
        expect(deps.err).toHaveBeenCalledWith(
          expect.stringContaining(difference),
        );
        expect(deps.render).not.toHaveBeenCalled();
        expect(fs.existsSync(deps.baselineFile)).toBe(false);
        expect(destroy).toHaveBeenCalledTimes(1);
      } finally {
        cleanup();
      }
    },
  );

  it("writes, then checks, a render from a source migrated to exactly migrations/core", async () => {
    const { deps, destroy, cleanup } = setup(
      LOCAL_ENV,
      [...CORE_FILES].reverse(),
    );
    try {
      expect(await runGenerateTenantBaseline([], deps)).toBe(0);
      expect(fs.readFileSync(deps.baselineFile, "utf8")).toBe(
        "rendered baseline\n",
      );
      expect(await runGenerateTenantBaseline(["--check"], deps)).toBe(0);
      fs.appendFileSync(deps.baselineFile, "// hand edit\n");
      expect(await runGenerateTenantBaseline(["--check"], deps)).toBe(1);
      expect(destroy).toHaveBeenCalledTimes(3);
    } finally {
      cleanup();
    }
  });

  it("compares histories as multisets", () => {
    expect(
      coreHistoryMismatch(["b.ts", "a.ts"], ["a.ts", "b.ts"]),
    ).toBeUndefined();
    expect(coreHistoryMismatch(["a.ts", "a.ts"], ["a.ts"])).toEqual(
      expect.stringContaining("(2 applied, 1 files)"),
    );
  });
});

describe("the knexfile opens no connection until knex needs one (N2)", () => {
  it("builds with no database env, and resolves each connection only when called", () => {
    const saved = {
      SQL_DATABASE: process.env.SQL_DATABASE,
      SQL_CORE_DATABASE: process.env.SQL_CORE_DATABASE,
    };
    delete process.env.SQL_DATABASE;
    delete process.env.SQL_CORE_DATABASE;
    try {
      const config = knexfileConfig();
      const core = config.core.connection as () => MigrationConnection;
      const tenant = config.tenant.connection as () => MigrationConnection;
      expect(typeof core).toBe("function");
      expect(typeof tenant).toBe("function");
      expect(core).toThrow(MissingDatabaseNameError);
      expect(tenant).toThrow(TenantConnectionNotConfiguredError);
      process.env.SQL_DATABASE = "zz_unit_core";
      expect(core()).toMatchObject({ database: "zz_unit_core", ssl: false });
      expect(config.core.migrations?.directory).toBe(
        migrationsDirectory("core"),
      );
      expect(config.tenant.migrations?.directory).toBe(
        migrationsDirectory("tenant"),
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
