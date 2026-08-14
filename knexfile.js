/*
 * DEAD FILE — do not edit, do not trust, do not copy from.
 *
 * A stale committed build artefact of an older `knexfile.ts` (commit 299323b,
 * "wip"). It predates the SSL opt-in and, since the connection registry landed,
 * it has no `connectionFor` either — so it no longer matches `knexfile.ts` in
 * any respect except the database name.
 *
 * Nothing uses it: every npm script passes `--knexfile knexfile.ts`, and
 * `deploy-backend.sh` ships `knexfile.ts` only. It survives here solely because
 * it was committed once.
 *
 * HAZARD: knex's CLI auto-discovers `knexfile.js` BEFORE `knexfile.ts`, so a
 * bare `npx knex migrate:latest` (no `--knexfile`) silently runs against this
 * config instead of the real one. It was updated to `SQL_DATABASE` only so the
 * AC-42 rename left nothing behind.
 *
 * Recommended: delete it in T3, which owns the migration configuration.
 */
"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isLocalhost =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const config = {
  development: {
    client: "postgresql",
    connection: {
      database: process.env.SQL_DATABASE,
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
      database: process.env.SQL_DATABASE,
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
      database: process.env.SQL_DATABASE,
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
exports.default = config;
