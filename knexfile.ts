import type { Knex } from "knex";
import dotenv from "dotenv";
import { connectionFor } from "./src/database/env";
dotenv.config();

const isLocalhost =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";

// Migrations run against the core database. `connectionFor` is the single place
// database env-var names are spelled (D-8), and with no per-key variable set it
// resolves to the shared SQL_DATABASE — one database, exactly as today. The
// tenant migration set and its per-database `knex_migrations` are a later track.
const core = connectionFor("core");

const sslOption = (): Knex.PgConnectionConfig["ssl"] =>
  process.env.SQL_SSL === "true" && !isLocalhost
    ? { rejectUnauthorized: false }
    : false;

const config: { [key: string]: Knex.Config } = {
  development: {
    client: "postgresql",
    connection: { ...core },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
      extension: "ts",
    },
  },

  staging: {
    client: "postgresql",
    connection: {
      ...core,
      // Opt-in, not host-derived: the deployed Postgres is a container on a
      // private Docker network with SSL disabled, so `traffic-postgres` (not
      // localhost) was being handed an SSL config it rejects — which is why
      // `migrate:latest` under NODE_ENV=production could never connect. The
      // app's own pool (src/database/registry.ts) has always used ssl:false.
      // Set SQL_SSL=true if the database ever moves to RDS.
      ssl: sslOption(),
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
      extension: "ts",
    },
  },

  production: {
    client: "postgresql",
    connection: {
      ...core,
      // Opt-in, not host-derived: the deployed Postgres is a container on a
      // private Docker network with SSL disabled, so `traffic-postgres` (not
      // localhost) was being handed an SSL config it rejects — which is why
      // `migrate:latest` under NODE_ENV=production could never connect. The
      // app's own pool (src/database/registry.ts) has always used ssl:false.
      // Set SQL_SSL=true if the database ever moves to RDS.
      ssl: sslOption(),
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
      extension: "ts",
    },
  },
};

export default config;
