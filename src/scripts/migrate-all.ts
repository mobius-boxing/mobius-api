import dotenv from "dotenv";
import { knex as createKnex } from "knex";
import {
  coreMigrationConnection,
  migrationConfigFor,
  migrationLog,
} from "../database/migration-sets";

/**
 * The deploy's migration step (db-per-company D-40):
 *
 *   npm run migrate:deploy [-- --core-only]
 *
 * Runs the core set. The later steps — `modules:sync`, then every tenant
 * database — need the tenant registry and arrive with it (T9). Until then
 * `--fleet-only` and `--company` are refused, never accepted and ignored
 * (L-007): a deploy that asked for tenants and silently migrated none would
 * look green.
 */

export type MigrateAllDeps = {
  migrateCore: () => Promise<readonly string[]>;
  out: (line: string) => void;
  err: (line: string) => void;
};

const USAGE = "usage: migrate-all [--core-only]";
const FLEET_FLAGS: readonly string[] = ["--fleet-only", "--company"];

export async function runMigrateAll(
  argv: readonly string[],
  deps: MigrateAllDeps,
): Promise<number> {
  const fleetFlag = argv.find((arg) => FLEET_FLAGS.includes(arg));
  if (fleetFlag !== undefined) {
    deps.err(
      `migrate-all: ${fleetFlag} refused: tenant fleet migration needs the ` +
        `tenant registry, which does not exist yet (db-per-company T9). ` +
        `Nothing was migrated.`,
    );
    return 2;
  }
  const unknown = argv.find((arg) => arg !== "--core-only");
  if (unknown !== undefined) {
    deps.err(`migrate-all: unknown argument ${unknown}\n${USAGE}`);
    return 2;
  }
  try {
    const applied = await deps.migrateCore();
    deps.out(
      applied.length === 0
        ? "[migrate] core: already up to date"
        : `[migrate] core: applied ${applied.length}: ${applied.join(", ")}`,
    );
    return 0;
  } catch (error) {
    deps.err(
      `[migrate] core failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
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

if (require.main === module) {
  dotenv.config();
  void runMigrateAll(process.argv.slice(2), {
    migrateCore,
    out: console.log,
    err: console.error,
  }).then((code) => {
    process.exitCode = code;
  });
}
