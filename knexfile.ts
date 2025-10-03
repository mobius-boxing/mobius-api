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
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
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
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
    },
  },
};

export default config;
