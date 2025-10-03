"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isLocalhost = process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const config = {
    development: {
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
exports.default = config;
