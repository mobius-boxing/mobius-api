import dotenv from "dotenv";
import { knex as createKnex, type Knex } from "knex";
import {
  coreMigrationConnection,
  migrationConfigFor,
  migrationLog,
} from "../database/migration-sets";
import { connectionForTenant } from "../database/env";
import { resolveCredential } from "../database/credential-resolver";
import { latestTenantMigrationFile } from "../services/tenant-provisioning.service";
import { syncModules } from "./modules-sync";
import { MODULE_MANIFESTS } from "../modules/registry";
import type {
  IDbServer,
  ITenantDatabase,
} from "../interfaces/tenant/tenant.interfaces";

/**
 * The deploy's migration step (db-per-company D-40, T9 AC-54):
 *
 *   npm run migrate:deploy [-- --core-only | --fleet-only | --company <uuid>]
 *
 * No flags: core, then `modules:sync`, then every live tenant not already on
 * the image's newest migration (D-18: attempt every tenant, report, never
 * stop at the first failure — the old container keeps serving because of
 * I-12). `--fleet-only` runs `modules:sync` + the fleet, no core. `--company
 * <uuid>` (a COMPANY uuid) migrates exactly that one tenant, no core, no
 * `modules:sync`. Self-contained like `db-bootstrap.ts`: its own knex
 * instances, no DAOs, no `database/registry` — a deploy-time script owns its
 * own connection lifecycle.
 */

const USAGE =
  "usage: migrate-all [--core-only | --fleet-only | --company <uuid>]";

export type FleetRow = {
  id: number;
  companyId: number;
  serverId: number;
  databaseName: string;
  dbUser: string;
  credentialRef: string;
  credentialCiphertext: Buffer | null;
  poolMin: number;
  poolMax: number;
  schemaVersion: string | null;
  migrationState: string;
};

export type FleetOutcome = {
  attempted: number;
  skippedCurrent: number;
  failed: readonly string[];
};

export type MigrateAllDeps = {
  migrateCore: () => Promise<readonly string[]>;
  syncModules: () => Promise<readonly string[]>;
  migrateFleet: (filter: { companyUuid?: string }) => Promise<FleetOutcome>;
  out: (line: string) => void;
  err: (line: string) => void;
};

type ParsedArgs =
  | { mode: "default" }
  | { mode: "core-only" }
  | { mode: "fleet-only" }
  | { mode: "company"; companyUuid: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: readonly string[]): ParsedArgs | string {
  if (argv.length === 0) return { mode: "default" };
  if (argv.length === 1 && argv[0] === "--core-only")
    return { mode: "core-only" };
  if (argv.length === 1 && argv[0] === "--fleet-only")
    return { mode: "fleet-only" };
  if (argv.length === 2 && argv[0] === "--company") {
    const companyUuid = argv[1] ?? "";
    if (!UUID_PATTERN.test(companyUuid)) {
      return `--company needs a uuid, got "${companyUuid}"`;
    }
    return { mode: "company", companyUuid };
  }
  return `unknown argument(s) ${argv.join(" ")}`;
}

export async function runMigrateAll(
  argv: readonly string[],
  deps: MigrateAllDeps,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    deps.err(`migrate-all: ${parsed}\n${USAGE}`);
    return 2;
  }

  if (parsed.mode === "default" || parsed.mode === "core-only") {
    try {
      const applied = await deps.migrateCore();
      deps.out(
        applied.length === 0
          ? "[migrate] core: already up to date"
          : `[migrate] core: applied ${applied.length}: ${applied.join(", ")}`,
      );
    } catch (error) {
      deps.err(
        `[migrate] core failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    if (parsed.mode === "core-only") return 0;
  }

  try {
    const warnings = await deps.syncModules();
    for (const warning of warnings) deps.err(`[migrate] ${warning}`);
    deps.out("[migrate] modules: synced");
  } catch (error) {
    deps.err(
      `[migrate] modules:sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const filter =
    parsed.mode === "company" ? { companyUuid: parsed.companyUuid } : {};
  const fleet = await deps.migrateFleet(filter);
  deps.out(
    `[migrate] fleet: attempted ${fleet.attempted}, skipped ${fleet.skippedCurrent} (already current), failed ${fleet.failed.length}` +
      (fleet.failed.length > 0 ? `: ${fleet.failed.join(", ")}` : ""),
  );
  return fleet.failed.length > 0 ? 1 : 0;
}

async function migrateCore(): Promise<readonly string[]> {
  const knex = createKnex({
    ...migrationConfigFor("core", coreMigrationConnection()),
    pool: { min: 0, max: 2 },
  });
  try {
    return migrationLog(await knex.migrate.latest());
  } finally {
    await knex.destroy();
  }
}

/** One knex instance for every fleet-management read/write in this run. */
function openCoreQueryKnex(): Knex {
  return createKnex({
    ...migrationConfigFor("core", coreMigrationConnection()),
    pool: { min: 0, max: 2 },
  });
}

async function realSyncModules(): Promise<readonly string[]> {
  const knex = openCoreQueryKnex();
  try {
    const summary = await syncModules(knex, MODULE_MANIFESTS);
    return summary.withoutManifest.map(
      (slug) =>
        `modules-sync: WARNING: module '${slug}' is in the catalogue but no manifest declares it; left unchanged`,
    );
  } finally {
    await knex.destroy();
  }
}

async function listFleetRows(
  coreKnex: Knex,
  filter: { companyUuid?: string },
): Promise<FleetRow[]> {
  const coreDatabase = coreMigrationConnection().database;
  let query = coreKnex("tenant_databases as td")
    .whereIn("td.status", ["active", "suspended"])
    .andWhere("td.databaseName", "<>", coreDatabase); // shared-target rows are migrated by the core step
  if (filter.companyUuid) {
    query = query
      .join("companies as c", "c.id", "td.companyId")
      .andWhere("c.uuid", filter.companyUuid);
  }
  return query.select("td.*");
}

/**
 * The fleet step (D-18, AC-54): every live dedicated tenant not already on
 * the image's newest migration is attempted; a failure is recorded and the
 * loop continues to the next tenant rather than aborting.
 */
export async function realMigrateFleet(filter: {
  companyUuid?: string;
}): Promise<FleetOutcome> {
  const coreKnex = openCoreQueryKnex();
  try {
    const latest = latestTenantMigrationFile();
    const rows = await listFleetRows(coreKnex, filter);
    let attempted = 0;
    let skippedCurrent = 0;
    const failed: string[] = [];

    for (const row of rows) {
      if (row.migrationState === "current" && row.schemaVersion === latest) {
        skippedCurrent += 1;
        continue;
      }
      attempted += 1;
      const server = await coreKnex("db_servers")
        .where("id", row.serverId)
        .first<IDbServer | undefined>();
      if (!server) {
        failed.push(row.databaseName);
        await coreKnex("tenant_databases")
          .where("id", row.id)
          .update({
            migrationState: "failed",
            lastMigrationAt: coreKnex.fn.now(),
            lastMigrationError: `db_servers #${row.serverId} not found`,
            updatedAt: coreKnex.fn.now(),
          });
        continue;
      }

      const [run] = await coreKnex("tenant_migration_runs")
        .insert({
          tenantDatabaseId: row.id,
          fromVersion: row.schemaVersion,
          toVersion: latest,
          triggeredBy: filter.companyUuid ? "cli" : "deploy",
        })
        .returning("id");
      const runId = (run as { id: number }).id;

      let tenantKnex: Knex | undefined;
      try {
        const password = await resolveCredential(
          row.credentialRef,
          row.credentialCiphertext,
        );
        tenantKnex = createKnex({
          ...migrationConfigFor(
            "tenant",
            connectionForTenant(
              row as unknown as ITenantDatabase,
              server,
              password,
            ),
          ),
          pool: { min: 0, max: 2 },
        });
        await tenantKnex.migrate.latest();
        const head = await tenantKnex("knex_migrations")
          .orderBy("id", "desc")
          .first("name");
        const schemaVersion = (head?.name as string | undefined) ?? latest;

        await coreKnex("tenant_databases").where("id", row.id).update({
          migrationState: "current",
          schemaVersion,
          lastMigrationAt: coreKnex.fn.now(),
          lastMigrationError: null,
          updatedAt: coreKnex.fn.now(),
        });
        await coreKnex("tenant_migration_runs").where("id", runId).update({
          status: "succeeded",
          finishedAt: coreKnex.fn.now(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(row.databaseName);
        await coreKnex("tenant_databases").where("id", row.id).update({
          migrationState: "failed",
          lastMigrationAt: coreKnex.fn.now(),
          lastMigrationError: message,
          updatedAt: coreKnex.fn.now(),
        });
        await coreKnex("tenant_migration_runs").where("id", runId).update({
          status: "failed",
          finishedAt: coreKnex.fn.now(),
          error: message,
        });
      } finally {
        if (tenantKnex) await tenantKnex.destroy();
      }
    }

    return { attempted, skippedCurrent, failed };
  } finally {
    await coreKnex.destroy();
  }
}

if (require.main === module) {
  dotenv.config();
  void runMigrateAll(process.argv.slice(2), {
    migrateCore,
    syncModules: realSyncModules,
    migrateFleet: realMigrateFleet,
    out: console.log,
    err: console.error,
  }).then((code) => {
    process.exitCode = code;
  });
}
