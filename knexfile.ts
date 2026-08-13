import type { Knex } from "knex";
import dotenv from "dotenv";
dotenv.config();

const isLocalhost =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";

const config: { [key: string]: Knex.Config } = {
  development: {
    client: "postgresql",
    connection: {
      database: process.env.SQL_DB_NAME,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      host: process.env.SQL_HOST,
      port: !!process.env.SQL_PORT ? +process.env.SQL_PORT : 5432,
      ssl: false, // EC2 database doesn't support SSL
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

  staging: {
    client: "postgresql",
    connection: {
      database: process.env.SQL_DB_NAME,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      host: process.env.SQL_HOST,
      port: !!process.env.SQL_PORT ? +process.env.SQL_PORT : 5432,
      // Opt-in, not host-derived: the deployed Postgres is a container on a
      // private Docker network with SSL disabled, so `traffic-postgres` (not
      // localhost) was being handed an SSL config it rejects — which is why
      // `migrate:latest` under NODE_ENV=production could never connect. The
      // app's own pool (src/database/KnexConnection.ts) has always used
      // ssl:false. Set SQL_SSL=true if the database ever moves to RDS.
      ssl:
        process.env.SQL_SSL === "true" && !isLocalhost
          ? { rejectUnauthorized: false }
          : false,
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
      database: process.env.SQL_DB_NAME,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      host: process.env.SQL_HOST,
      port: !!process.env.SQL_PORT ? +process.env.SQL_PORT : 5432,
      // Opt-in, not host-derived: the deployed Postgres is a container on a
      // private Docker network with SSL disabled, so `traffic-postgres` (not
      // localhost) was being handed an SSL config it rejects — which is why
      // `migrate:latest` under NODE_ENV=production could never connect. The
      // app's own pool (src/database/KnexConnection.ts) has always used
      // ssl:false. Set SQL_SSL=true if the database ever moves to RDS.
      ssl:
        process.env.SQL_SSL === "true" && !isLocalhost
          ? { rejectUnauthorized: false }
          : false,
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
