import { randomBytes } from "crypto";
import dotenv from "dotenv";
import { knex as createKnex } from "knex";
import { Client } from "pg";
import {
  coreMigrationConnection,
  localOnlyRefusal,
  migrationConfigFor,
  migrationLog,
  type MigrationConnection,
  type MigrationSet,
} from "../database/migration-sets";

/**
 * Local databases built from the migration sets (db-per-company T5):
 *
 *   npm run db:bootstrap                                   SQL_DATABASE, created if missing, core set
 *   npm run db:bootstrap -- --scratch-tenant [--run <id>]  zz_jest_tenant_<id>, tenant set
 *
 * Creating a database needs CREATEDB: `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD`
 * name a role that has it (the pair the real-DB suites use), otherwise
 * `SQL_USER` is tried. The database is owned by `SQL_USER`, which applies the
 * migrations, so the schema belongs to the application role as it would in a
 * provisioned tenant.
 *
 * A scratch tenant is left in place for whoever asked for it to drop; its name
 * is the last line printed.
 */

const USAGE = "usage: db:bootstrap [-- --scratch-tenant [--run <id>]]";
const RUN_ID = /^[a-z0-9]{1,40}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export const scratchTenantDatabase = (runId: string): string =>
  `zz_jest_tenant_${runId}`;

export type BootstrapTarget = {
  set: MigrationSet;
  database: string;
  mustNotExist: boolean;
};

export type DbBootstrapDeps = {
  env: NodeJS.ProcessEnv;
  connection: () => MigrationConnection;
  /** `true` when the database was created, `false` when it already existed. */
  createDatabase: (
    target: BootstrapTarget,
    connection: MigrationConnection,
  ) => Promise<boolean>;
  migrate: (
    target: BootstrapTarget,
    connection: MigrationConnection,
  ) => Promise<readonly string[]>;
  out: (line: string) => void;
  err: (line: string) => void;
};

type ParsedArgs =
  | { scratchTenant: false }
  | { scratchTenant: true; runId: string | undefined };

/**
 * Argument parsing only — no connection needed, so an unknown flag is refused
 * (exit 2, usage) before `deps.connection()` ever runs. Resolving the
 * connection first made a bad flag fail with `MissingDatabaseNameError`
 * whenever `SQL_DATABASE` was unset, hiding the real problem behind exit 1.
 */
function parseArgs(argv: readonly string[]): ParsedArgs | string {
  const tokens = [...argv];
  let scratchTenant = false;
  let runId: string | undefined;
  while (tokens.length > 0) {
    const token = tokens.shift();
    if (token === "--scratch-tenant") {
      scratchTenant = true;
    } else if (token === "--run") {
      runId = tokens.shift();
      if (runId === undefined || !RUN_ID.test(runId)) {
        return "--run needs a lowercase alphanumeric id of at most 40 characters";
      }
    } else {
      return `unknown argument ${String(token)}`;
    }
  }
  if (!scratchTenant && runId !== undefined) {
    return "--run applies only to --scratch-tenant";
  }
  return { scratchTenant, runId };
}

function targetFor(parsed: ParsedArgs, coreDatabase: string): BootstrapTarget {
  if (!parsed.scratchTenant) {
    return { set: "core", database: coreDatabase, mustNotExist: false };
  }
  return {
    set: "tenant",
    database: scratchTenantDatabase(
      parsed.runId ?? randomBytes(4).toString("hex"),
    ),
    mustNotExist: true,
  };
}

const createDatabaseAs =
  (env: NodeJS.ProcessEnv): DbBootstrapDeps["createDatabase"] =>
  async (target, connection) => {
    const adminUser = env.SQL_ADMIN_USER ?? connection.user;
    const admin = new Client({
      host: connection.host,
      port: connection.port,
      user: adminUser,
      password: env.SQL_ADMIN_USER
        ? env.SQL_ADMIN_PASSWORD
        : connection.password,
      database: "postgres",
    });
    await admin.connect();
    try {
      const role = await admin.query<{ allowed: boolean; name: string }>(
        `select rolcreatedb or rolsuper as allowed, current_user as name
           from pg_roles where rolname = current_user`,
      );
      const self = role.rows[0];
      if (!self?.allowed) {
        throw new Error(
          `role ${adminUser ?? "(default)"} lacks CREATEDB: set ` +
            `SQL_ADMIN_USER/SQL_ADMIN_PASSWORD to a role that has it`,
        );
      }
      const existing = await admin.query(
        `select 1 from pg_database where datname = $1`,
        [target.database],
      );
      if ((existing.rowCount ?? 0) > 0) {
        if (target.mustNotExist) {
          throw new Error(`${target.database} already exists`);
        }
        return false;
      }
      const owner = connection.user;
      const ownerClause =
        owner !== undefined && owner !== self.name ? ` OWNER "${owner}"` : "";
      await admin.query(`CREATE DATABASE "${target.database}"${ownerClause}`);
      return true;
    } finally {
      await admin.end();
    }
  };

const migrateTarget: DbBootstrapDeps["migrate"] = async (
  target,
  connection,
) => {
  const knex = createKnex({
    ...migrationConfigFor(target.set, {
      ...connection,
      database: target.database,
    }),
    pool: { min: 0, max: 2 },
  });
  try {
    return migrationLog(await knex.migrate.latest());
  } finally {
    await knex.destroy();
  }
};

export const dbBootstrapDeps = (env: NodeJS.ProcessEnv): DbBootstrapDeps => ({
  env,
  connection: coreMigrationConnection,
  createDatabase: createDatabaseAs(env),
  migrate: migrateTarget,
  out: console.log,
  err: console.error,
});

export async function runDbBootstrap(
  argv: readonly string[],
  deps: DbBootstrapDeps,
): Promise<number> {
  const refusal = localOnlyRefusal("db:bootstrap", deps.env);
  if (refusal !== undefined) {
    deps.err(refusal);
    return 1;
  }
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    deps.err(`db:bootstrap: ${parsed}\n${USAGE}`);
    return 2;
  }
  try {
    const connection = deps.connection();
    const target = targetFor(parsed, connection.database);
    const unsafe = [target.database, connection.user].find(
      (name) => name !== undefined && !IDENTIFIER.test(name),
    );
    if (unsafe !== undefined) {
      deps.err(`db:bootstrap: refusing to interpolate identifier ${unsafe}`);
      return 2;
    }
    const created = await deps.createDatabase(target, connection);
    deps.out(
      `[bootstrap] ${target.database}: ${created ? "created" : "already exists"}`,
    );
    const applied = await deps.migrate(target, connection);
    deps.out(
      `[bootstrap] ${target.set} set: ${
        applied.length === 0
          ? "already up to date"
          : `applied ${applied.join(", ")}`
      }`,
    );
    deps.out(target.database);
    return 0;
  } catch (error) {
    deps.err(
      `db:bootstrap: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (require.main === module) {
  dotenv.config();
  void runDbBootstrap(process.argv.slice(2), dbBootstrapDeps(process.env)).then(
    (code) => {
      process.exitCode = code;
    },
  );
}
