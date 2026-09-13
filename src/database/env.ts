export type ConnectionSettings = {
  host: string | undefined;
  port: number;
  database: string;
  user: string | undefined;
  password: string | undefined;
  /** The EC2 Postgres is a container on a private Docker network with SSL off. */
  ssl: false;
};

export class MissingDatabaseNameError extends Error {
  constructor(key: "core", perKeyVariable: string) {
    super(
      `No database name for the "${key}" connection: neither ${perKeyVariable} ` +
        `nor SQL_DATABASE is set. Refusing to start rather than let pg fall ` +
        `back to a database named after the connecting user.`,
    );
    this.name = "MissingDatabaseNameError";
  }
}

/**
 * The only place database environment variable names appear (AC-4, AC-42).
 *
 * The core connection reads `SQL_CORE_DATABASE` / `_USER` / `_PASSWORD` and
 * falls back to the shared `SQL_DATABASE` / `SQL_USER` / `SQL_PASSWORD` when
 * the per-key variable is unset. `SQL_HOST` and `SQL_PORT` are always shared.
 *
 * There is no tenant variant on purpose: a tenant's connection comes from its
 * central registry row, never from the environment (db-per-company D-7, D-41).
 * Until tenant resolution exists, `tenant` is served by this same connection
 * (D-29).
 *
 * The database name variable is `SQL_DATABASE` (D-8), the name
 * `NEW_PROJECT_ON_SHARED_INFRA.md` §4.1 already declares normative; the older
 * per-app spelling it replaces appears nowhere in the repo any more.
 *
 * A missing database name is fatal, not defaulted. `pg` silently connects to a
 * database *named after the connecting user* when none is given, so an env file
 * that still carries the pre-D-8 spelling would not fail — it would connect
 * somewhere plausible and wrong. That is precisely the mis-ordered-deploy
 * scenario, so it is refused here instead.
 */
export function connectionFor(key: "core"): ConnectionSettings {
  const prefix = `SQL_${key.toUpperCase()}_`;
  const perKeyVariable = `${prefix}DATABASE`;
  const database = process.env[perKeyVariable] ?? process.env.SQL_DATABASE;
  if (!database) throw new MissingDatabaseNameError(key, perKeyVariable);

  return {
    host: process.env.SQL_HOST,
    port: Number(process.env.SQL_PORT) || 5432,
    database,
    user: process.env[`${prefix}USER`] ?? process.env.SQL_USER,
    password: process.env[`${prefix}PASSWORD`] ?? process.env.SQL_PASSWORD,
    ssl: false,
  };
}
