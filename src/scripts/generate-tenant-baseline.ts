import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import { knex as createKnex, type Knex } from "knex";
import {
  AUDIT_PARENT,
  AUDIT_REDACT,
  auditedTablesOf,
} from "../database/audit-coverage";
import {
  AUDIT_FUNCTION_SQL,
  AUDIT_TRIGGER_NAME,
  PROTECTION_FUNCTION_SQL,
  attachAudit,
  createAuditLogsV2,
} from "../database/audit-triggers";
import {
  crossPlaneRefs,
  type CrossPlaneRef,
} from "../database/cross-plane-refs";
import {
  TENANT_BASELINE_FILE,
  coreMigrationConnection,
  localOnlyRefusal,
  migrationsDirectory,
  type MigrationConnection,
} from "../database/migration-sets";
import { tablesOf } from "../database/ownership";

/**
 * Writes `migrations/tenant/00000000000000_baseline.ts` (db-per-company D-17,
 * D-42, AC-27):
 *
 *   PG_DUMP=/opt/homebrew/opt/postgresql@16/bin/pg_dump SQL_HOST=localhost … \
 *   npx ts-node src/scripts/generate-tenant-baseline.ts [--check]
 *
 * Source: `pg_dump --schema-only` of the tenant plane's tables in the LOCAL
 * database named by SQL_DATABASE, migrated to the latest core set. Every
 * foreign key `crossPlaneRefs` reports is dropped, and a column it leaves
 * without an index led by that column gets one.
 *
 * The ledger, its two functions and every trigger are not taken from the dump:
 * they are rendered from `audit-triggers.ts` and `audit-coverage.ts`, so the
 * baseline attaches exactly what the manifest assigns to the tenant plane.
 * Monthly ledger partitions depend on the date the baseline runs, so the
 * migration creates them at run time.
 *
 * The output carries no timestamp, host or pg_dump restrict token, so an
 * unchanged schema regenerates the file byte-for-byte. `--check` compares
 * instead of writing and exits 1 on any difference.
 */

type DumpSection = { name: string; type: string; body: string };

const KEPT_SECTION_TYPES: ReadonlySet<string> = new Set([
  "TABLE",
  "SEQUENCE",
  "SEQUENCE OWNED BY",
  "DEFAULT",
  "CONSTRAINT",
  "INDEX",
  "FK CONSTRAINT",
  "COMMENT",
]);

const SECTION_HEADER =
  /^--\n-- Name: (.+?); Type: (.+?); Schema: .*?; Owner: .*\n--\n/gm;
const DUMP_COMPLETE = "\n--\n-- PostgreSQL database dump complete\n--\n";
const REFERENCED_TABLE = /REFERENCES\s+public\.("?)([A-Za-z0-9_]+)\1\s*\(/;
const MAX_IDENTIFIER_LENGTH = 63;

export const baselinePath = (): string =>
  path.join(migrationsDirectory("tenant"), TENANT_BASELINE_FILE);

/**
 * The dump's object sections, without the session `SET`s before the first one
 * (one of them empties `search_path` for the rest of the session) and without
 * the trailer.
 */
function parseDumpSections(dump: string): DumpSection[] {
  const end = dump.indexOf(DUMP_COMPLETE);
  if (end < 0) {
    throw new Error("pg_dump output has no completion marker");
  }
  const text = dump.slice(0, end);
  const headers: { start: number; end: number; name: string; type: string }[] =
    [];
  const pattern = new RegExp(SECTION_HEADER.source, "gm");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    headers.push({
      start: match.index,
      end: match.index + match[0].length,
      name: match[1],
      type: match[2],
    });
  }
  return headers.map((header, i) => ({
    name: header.name,
    type: header.type,
    body: text.slice(header.end, headers[i + 1]?.start ?? text.length).trim(),
  }));
}

function dumpSchema(
  source: MigrationConnection,
  pgDump: string,
  tables: readonly string[],
): string {
  const args = [
    "--schema-only",
    "--no-owner",
    "--no-acl",
    "--no-password",
    "--port",
    String(source.port),
  ];
  if (source.host) args.push("--host", source.host);
  if (source.user) args.push("--username", source.user);
  for (const table of tables) args.push("--table", `public."${table}"`);
  args.push("--dbname", source.database);
  try {
    return execFileSync(pgDump, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: source.password ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `${pgDump} failed — set PG_DUMP to the pg_dump of the server's major ` +
        `version: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function withoutCrossPlaneForeignKeys(
  sections: readonly DumpSection[],
  refs: readonly CrossPlaneRef[],
  tenantTables: ReadonlySet<string>,
): DumpSection[] {
  const dropped = new Set(
    refs.map((ref) => `${ref.table} ${ref.constraintName}`),
  );
  const seen = new Set<string>();
  const kept = sections.filter((section) => {
    if (section.type !== "FK CONSTRAINT") return true;
    if (dropped.has(section.name)) {
      seen.add(section.name);
      return false;
    }
    const target = REFERENCED_TABLE.exec(section.body)?.[2];
    if (target === undefined || !tenantTables.has(target)) {
      throw new Error(
        `FK ${section.name} references ${target ?? "an unparsed table"}, ` +
          `outside the tenant plane, and crossPlaneRefs did not report it`,
      );
    }
    return true;
  });
  const missing = [...dropped].filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new Error(
      `crossPlaneRefs reported FKs the dump lacks: ${missing.join(", ")}`,
    );
  }
  return kept;
}

/**
 * An index for each former cross-plane column that no non-partial index leads
 * with: dropping the FK must not leave `purgeUser`-style lookups by that
 * column scanning the table (I-5).
 */
async function indexesForUnindexedColumns(
  knex: Knex,
  refs: readonly CrossPlaneRef[],
  sections: readonly DumpSection[],
): Promise<DumpSection[]> {
  const columns = [
    ...new Map(refs.map((ref) => [`${ref.table}.${ref.column}`, ref])).values(),
  ];
  const result = (await knex.raw(
    `select c.relname as "table", a.attname as "column"
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where n.nspname = 'public'
        and i.indpred is null
        and c.relname = any(?)`,
    [[...new Set(columns.map((ref) => ref.table))]],
  )) as { rows: { table: string; column: string }[] };
  const indexed = new Set(
    result.rows.map((row) => `${row.table}.${row.column}`),
  );
  const takenNames = new Set(
    sections
      .filter((s) => s.type === "INDEX" || s.type === "CONSTRAINT")
      .map((s) => s.name.split(" ").pop() ?? ""),
  );
  return columns
    .filter((ref) => !indexed.has(`${ref.table}.${ref.column}`))
    .map((ref) => {
      const name = `${ref.table}_${ref.column.toLowerCase()}_index`;
      if (name.length > MAX_IDENTIFIER_LENGTH || takenNames.has(name)) {
        throw new Error(
          `cannot name the index for ${ref.table}.${ref.column}: ${name}`,
        );
      }
      return {
        name,
        type: "INDEX",
        body: `CREATE INDEX ${name} ON public.${ref.table} USING btree ("${ref.column}");`,
      };
    });
}

async function auditStatements(): Promise<string[]> {
  const statements: string[] = [];
  // `createAuditLogsV2` and `attachAudit` are the only spelling of the ledger
  // and trigger SQL, and they only call `raw`. Recording those calls renders
  // exactly what the core migration ran, instead of re-spelling it here.
  const recorder = {
    raw: async (sql: string): Promise<void> => {
      statements.push(sql.trim());
    },
  } as unknown as Knex;
  await createAuditLogsV2(recorder);
  statements.push(AUDIT_FUNCTION_SQL.trim());
  for (const table of auditedTablesOf("tenant")) {
    await attachAudit(recorder, table, {
      exclude: AUDIT_REDACT[table],
      parent: AUDIT_PARENT[table],
    });
  }
  statements.push(PROTECTION_FUNCTION_SQL.trim());
  return statements;
}

const asTemplateLiteral = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

function renderModule(sql: string): string {
  return [
    'import type { Knex } from "knex";',
    'import { ensureAuditPartitions } from "../../src/database/audit-triggers";',
    "",
    "/**",
    " * GENERATED by `src/scripts/generate-tenant-baseline.ts`. Never edit it by",
    " * hand: regenerate, and `git diff migrations/tenant` must then be empty.",
    " *",
    " * The first migration of every tenant database (db-per-company D-17): the",
    " * tenant plane's tables from a schema-only dump of the local core database,",
    " * with every foreign key to a central table dropped and its column indexed,",
    " * then the audit ledger, its functions and the triggers the audit manifest",
    " * assigns to the tenant plane. Ledger partitions are created when it runs.",
    " *",
    " * Every later tenant migration must stay compatible with the previous image",
    " * (I-12), because the fleet migrates before the container swap.",
    " */",
    "const BASELINE_SQL = `",
    asTemplateLiteral(sql),
    "`;",
    "",
    "export async function up(knex: Knex): Promise<void> {",
    "  await knex.raw(BASELINE_SQL);",
    "  await ensureAuditPartitions(knex);",
    "}",
    "",
    "export async function down(): Promise<void> {",
    "  throw new Error(",
    '    "The tenant baseline cannot be rolled back: drop the database (L-003).",',
    "  );",
    "}",
    "",
  ].join("\n");
}

export async function renderTenantBaseline(
  knex: Knex,
  source: MigrationConnection,
  pgDump: string,
): Promise<string> {
  const tenantTables = tablesOf("tenant");
  const refs = await crossPlaneRefs(knex);
  const sections = parseDumpSections(
    dumpSchema(
      source,
      pgDump,
      tenantTables.filter((table) => table !== "audit_logs"),
    ),
  );
  const unhandled = sections.filter(
    (section) =>
      !KEPT_SECTION_TYPES.has(section.type) &&
      !(
        section.type === "TRIGGER" &&
        section.name.endsWith(` ${AUDIT_TRIGGER_NAME}`)
      ),
  );
  if (unhandled.length > 0) {
    throw new Error(
      `pg_dump emitted sections the baseline does not handle: ${unhandled
        .map((section) => `${section.type} ${section.name}`)
        .join(", ")}`,
    );
  }
  const schema = withoutCrossPlaneForeignKeys(
    sections.filter((section) => section.type !== "TRIGGER"),
    refs,
    new Set(tenantTables),
  );
  const indexes = await indexesForUnindexedColumns(knex, refs, schema);
  const sql = [
    ...[...schema, ...indexes].map((section) => section.body),
    ...(await auditStatements()),
  ].join("\n\n");
  return renderModule(sql);
}

export async function runGenerateTenantBaseline(
  argv: readonly string[],
  out: (line: string) => void,
  err: (line: string) => void,
): Promise<number> {
  const refusal = localOnlyRefusal("generate-tenant-baseline", process.env);
  if (refusal !== undefined) {
    err(refusal);
    return 1;
  }
  const unknown = argv.find((arg) => arg !== "--check");
  if (unknown !== undefined) {
    err(
      `generate-tenant-baseline: unknown argument ${unknown}\n` +
        "usage: generate-tenant-baseline [--check]",
    );
    return 2;
  }
  const source = coreMigrationConnection();
  const knex = createKnex({
    client: "pg",
    connection: source,
    pool: { min: 0, max: 1 },
  });
  try {
    const rendered = await renderTenantBaseline(
      knex,
      source,
      process.env.PG_DUMP ?? "pg_dump",
    );
    const file = baselinePath();
    if (argv.includes("--check")) {
      const committed = fs.existsSync(file)
        ? fs.readFileSync(file, "utf8")
        : "";
      if (committed !== rendered) {
        err(`${file} differs from a fresh render: regenerate it`);
        return 1;
      }
      out(`${file} is current`);
      return 0;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rendered);
    out(`wrote ${file}`);
    return 0;
  } catch (error) {
    err(
      `generate-tenant-baseline: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    await knex.destroy();
  }
}

if (require.main === module) {
  dotenv.config();
  void runGenerateTenantBaseline(
    process.argv.slice(2),
    console.log,
    console.error,
  ).then((code) => {
    process.exitCode = code;
  });
}
