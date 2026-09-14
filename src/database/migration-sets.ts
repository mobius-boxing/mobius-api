import path from "path";
import type { Knex } from "knex";
import { connectionFor, type ConnectionSettings } from "./env";

/**
 * The two migration sets (db-per-company D-17): `core` is the central
 * database's history, `tenant` starts from a generated baseline and runs once
 * per tenant database, each database keeping its own `knex_migrations`.
 *
 * `knexfile.ts` and the migration scripts both build their configuration here,
 * so the CLI and `migrate:deploy` cannot disagree about directories or SSL.
 */
export type MigrationSet = "core" | "tenant";

export const MIGRATIONS_TABLE = "knex_migrations";

export const TENANT_BASELINE_FILE = "00000000000000_baseline.ts";

// Two levels up is the API root from src/database (ts-node) and dist/database.
const API_ROOT = path.resolve(__dirname, "..", "..");

export const migrationsDirectory = (set: MigrationSet): string =>
  path.join(API_ROOT, "migrations", set);

export const seedsDirectory = (set: MigrationSet): string =>
  path.join(API_ROOT, "seeds", set);

const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

export const isLocalDatabaseHost = (host: string | undefined): boolean =>
  host !== undefined && LOCAL_HOSTS.includes(host);

export type MigrationConnection = Omit<ConnectionSettings, "ssl"> & {
  ssl: false | { rejectUnauthorized: false };
};

export function coreMigrationConnection(): MigrationConnection {
  const core = connectionFor("core");
  return {
    ...core,
    // Opt-in, not host-derived: the deployed Postgres is a container on a
    // private Docker network with SSL disabled, so `traffic-postgres` (not
    // localhost) was being handed an SSL config it rejects — which is why
    // `migrate:latest` under NODE_ENV=production could never connect. The
    // app's own pool (src/database/registry.ts) has always used ssl:false.
    // Set SQL_SSL=true if the database ever moves to RDS.
    ssl:
      process.env.SQL_SSL === "true" && !isLocalDatabaseHost(core.host)
        ? { rejectUnauthorized: false }
        : false,
  };
}

export function migrationConfigFor(
  set: MigrationSet,
  connection: Knex.Config["connection"],
): Knex.Config {
  return {
    client: "postgresql",
    connection,
    migrations: {
      directory: migrationsDirectory(set),
      tableName: MIGRATIONS_TABLE,
      extension: "ts",
    },
    seeds: { directory: seedsDirectory(set) },
  };
}

export class TenantConnectionNotConfiguredError extends Error {
  constructor() {
    super(
      "The knexfile's tenant env has no connection: a tenant database is " +
        "reached through its registry row, never through environment " +
        "variables (db-per-company D-41). Tenant migrations run through " +
        "migrate-all or provisioning, a scratch tenant through " +
        "`npm run db:bootstrap -- --scratch-tenant`; " +
        "`npm run migrate:create:tenant` needs no connection.",
    );
    this.name = "TenantConnectionNotConfiguredError";
  }
}

export const refuseTenantConnection = (): never => {
  throw new TenantConnectionNotConfiguredError();
};

/**
 * `knexfile.ts`'s envs. Both connections are providers that knex calls only
 * when it opens one, so `migrate:make` works with no database env at all.
 */
export function knexfileConfig(): Record<MigrationSet, Knex.Config> {
  return {
    core: {
      ...migrationConfigFor("core", coreMigrationConnection),
      pool: {
        min: 2,
        max: 10,
      },
    },
    tenant: migrationConfigFor("tenant", refuseTenantConnection),
  };
}

/**
 * Why `command` must not run in this environment, or `undefined` when it may.
 *
 * `SQL_HOST` unset is refused too: nothing proves it is local. Callers load
 * `.env` first, because the repo's `.env` is the production one
 * (`NODE_ENV=production`, `SQL_HOST=traffic-postgres`) and a shell that sets
 * only `SQL_HOST=localhost` must still be refused on its `NODE_ENV`.
 */
export function localOnlyRefusal(
  command: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const rule =
    "It runs only against a local database: production is roll-forward " +
    "only (L-003), fix forward with a new migration.";
  if (env.NODE_ENV === "production") {
    return `${command} refused: NODE_ENV=production. ${rule}`;
  }
  if (!isLocalDatabaseHost(env.SQL_HOST)) {
    return `${command} refused: SQL_HOST=${env.SQL_HOST ?? "(unset)"} is not localhost or 127.0.0.1. ${rule}`;
  }
  return undefined;
}

/** The file names knex's `migrate.latest()` / `migrate.rollback()` report. */
export const migrationLog = (result: unknown): string[] =>
  Array.isArray(result) && Array.isArray(result[1])
    ? result[1].map((name: unknown) => String(name))
    : [];
