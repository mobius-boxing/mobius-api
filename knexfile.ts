import type { Knex } from "knex";
import dotenv from "dotenv";
import {
  coreMigrationConnection,
  migrationConfigFor,
  refuseTenantConnection,
  type MigrationSet,
} from "./src/database/migration-sets";
dotenv.config();

/**
 * One env per migration set (db-per-company D-17, D-41), so every knex CLI
 * call names its set: `--env core` or `--env tenant`. `connectionFor` is still
 * the single place database env-var names are spelled (D-8).
 *
 * `tenant` has no connection on purpose: `migrate:create:tenant` only writes a
 * file, and anything that would connect fails with the reason.
 */
const config: Record<MigrationSet, Knex.Config> = {
  core: {
    ...migrationConfigFor("core", coreMigrationConnection()),
    pool: {
      min: 2,
      max: 10,
    },
  },
  tenant: migrationConfigFor("tenant", refuseTenantConnection),
};

export default config;
