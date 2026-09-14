/**
 * T6/D-orch-1 — an already-applied core migration must never derive its DDL
 * from a LIVE registry (`ownership.ts` / `audit-coverage.ts`). Those files
 * grow as later tracks add tables; an already-applied migration never
 * re-runs where it has already run, so a later addition cannot change what
 * it already did there — but a brand-new environment replays the full
 * migration history in order, and a migration reading the live registry then
 * runs BEFORE whatever later migration creates the table the registry just
 * gained, aborting the whole bootstrap with `relation "..." does not exist`.
 *
 * `20260901000001_audit_logs_v2.ts` hit exactly this once T6 added
 * `db_servers`/`tenant_databases`/`tenant_migration_runs` to `ownership.ts`;
 * its table list is now a frozen literal instead. This test is the guard
 * against the same mistake in any future core migration.
 *
 * `attachAudit`/`detachAudit` from `audit-triggers.ts` remain fine to import:
 * they are inert SQL-generating helpers that take an explicit table name,
 * not a live list (see `20260913000004_attach_audit_registry_tables.ts`).
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { migrationsDirectory } from "../../database/migration-sets";

const CORE_MIGRATIONS_DIR = migrationsDirectory("core");

/** Any import whose specifier contains one of these reads a live registry. */
const BANNED_SPECIFIERS = ["database/ownership", "database/audit-coverage"];

const importSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const importRe =
    /import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let match = importRe.exec(source);
  while (match !== null) {
    specifiers.push(match[1]);
    match = importRe.exec(source);
  }
  return specifiers;
};

describe("migrations/core never imports a live registry (T6/D-orch-1)", () => {
  it("finds no ownership.ts / audit-coverage.ts import in any core migration", () => {
    const files = fs
      .readdirSync(CORE_MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(
        path.join(CORE_MIGRATIONS_DIR, file),
        "utf8",
      );
      for (const specifier of importSpecifiers(source)) {
        if (BANNED_SPECIFIERS.some((banned) => specifier.includes(banned))) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
