import dotenv from "dotenv";
import { knex as createKnex } from "knex";
import {
  coreMigrationConnection,
  localOnlyRefusal,
  migrationConfigFor,
  migrationLog,
} from "../database/migration-sets";

/**
 * `npm run migrate:rollback` — rolls back the core set's last batch, and only
 * on a local database (AC-28, L-003). The refusal is decided before anything
 * connects.
 */

export type MigrateRollbackDeps = {
  env: NodeJS.ProcessEnv;
  rollbackCore: () => Promise<readonly string[]>;
  out: (line: string) => void;
  err: (line: string) => void;
};

export async function runMigrateRollback(
  argv: readonly string[],
  deps: MigrateRollbackDeps,
): Promise<number> {
  const refusal = localOnlyRefusal("migrate:rollback", deps.env);
  if (refusal !== undefined) {
    deps.err(refusal);
    return 1;
  }
  if (argv.length > 0) {
    deps.err(
      `migrate:rollback: unknown argument ${argv[0]}\nusage: migrate:rollback`,
    );
    return 2;
  }
  try {
    const rolledBack = await deps.rollbackCore();
    deps.out(
      rolledBack.length === 0
        ? "[rollback] core: nothing to roll back"
        : `[rollback] core: rolled back ${rolledBack.length}: ${rolledBack.join(", ")}`,
    );
    return 0;
  } catch (error) {
    deps.err(
      `[rollback] core failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

async function rollbackCore(): Promise<readonly string[]> {
  const knex = createKnex({
    ...migrationConfigFor("core", coreMigrationConnection()),
    pool: { min: 0, max: 2 },
  });
  try {
    return migrationLog(await knex.migrate.rollback());
  } finally {
    await knex.destroy();
  }
}

if (require.main === module) {
  dotenv.config();
  void runMigrateRollback(process.argv.slice(2), {
    env: process.env,
    rollbackCore,
    out: console.log,
    err: console.error,
  }).then((code) => {
    process.exitCode = code;
  });
}
