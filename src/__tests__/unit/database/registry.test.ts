/**
 * The connection registry: lifecycle, env resolution, the wrong-database guard
 * and the pool budget (AC-3, AC-4, AC-6, AC-31, AC-44).
 *
 * No database is touched. `knex` is mocked at the module boundary so the tests
 * exercise the registry's own logic — which pools it builds, with what config,
 * and what it lets through the Proxy — rather than Postgres.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import type { Knex } from "knex";

type FakeKnex = ((table?: unknown) => unknown) & {
  raw: jest.Mock;
  destroy: jest.Mock;
  on: jest.Mock;
  transaction: jest.Mock;
  from: jest.Mock;
  table: jest.Mock;
  config: unknown;
};

const mockInstances: FakeKnex[] = [];
let mockRawFails = false;

type QueryListener = (query: { sql: string; method?: string }) => void;
const queryListeners: QueryListener[] = [];

const makeFakeKnex = (config: unknown): FakeKnex => {
  const instance = ((table?: unknown) => ({ table })) as FakeKnex;
  instance.config = config;
  instance.raw = jest.fn(() =>
    mockRawFails
      ? Promise.reject(new Error("connection refused"))
      : Promise.resolve({ rows: [] }),
  ) as jest.Mock;
  instance.destroy = jest.fn(() => Promise.resolve()) as jest.Mock;
  instance.from = jest.fn((table?: unknown) => ({ table })) as jest.Mock;
  instance.table = jest.fn((table?: unknown) => ({ table })) as jest.Mock;
  instance.on = jest.fn((event: unknown, listener: unknown) => {
    if (event === "query") queryListeners.push(listener as QueryListener);
    return instance;
  }) as jest.Mock;
  instance.transaction = jest.fn(function (
    this: FakeKnex | undefined,
    callback: unknown,
  ) {
    // Real knex reaches for `this.client`, so a method handed out of the Proxy
    // unbound would blow up here rather than in a test double.
    if (this !== instance) {
      return Promise.reject(
        new Error("transaction() called without its knex instance as `this`"),
      );
    }
    // A transaction object is itself callable, exactly like the knex instance.
    const trx = ((table?: unknown) => ({
      table,
    })) as unknown as Knex.Transaction;
    // Knex supports both shapes: with a callback it runs it, without one it
    // resolves to a bare handle the caller drives itself.
    if (typeof callback !== "function") return Promise.resolve(trx);
    return Promise.resolve((callback as (t: Knex.Transaction) => unknown)(trx));
  }) as jest.Mock;
  return instance;
};

jest.mock("knex", () => ({ __esModule: true, knex: jest.fn() }));

import { knex } from "knex";
import {
  db,
  connectAll,
  disconnectAll,
  POOL_MAX,
  POOL_BUDGET,
  DatabaseNotConnectedError,
  WrongDatabaseError,
} from "../../../database/registry";
import { MissingDatabaseNameError } from "../../../database/env";
import { DB_KEYS, DbKey } from "../../../database/keys";

const DB_ENV_VARS = [
  "SQL_DATABASE",
  "SQL_USER",
  "SQL_PASSWORD",
  "SQL_HOST",
  "SQL_PORT",
  ...DB_KEYS.flatMap((key) => [
    `SQL_${key.toUpperCase()}_DATABASE`,
    `SQL_${key.toUpperCase()}_USER`,
    `SQL_${key.toUpperCase()}_PASSWORD`,
  ]),
];

const configOf = (index: number): { connection: Record<string, unknown> } =>
  mockInstances[index]?.config as { connection: Record<string, unknown> };

describe("connection registry", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(DB_ENV_VARS.map((k) => [k, process.env[k]]));
    for (const key of DB_ENV_VARS) delete process.env[key];
    process.env.SQL_DATABASE = "one_database";
    process.env.SQL_USER = "one_user";
    process.env.SQL_PASSWORD = "one_password";
    process.env.SQL_HOST = "localhost";
    mockInstances.length = 0;
    queryListeners.length = 0;
    mockRawFails = false;
    // `resetMocks` wipes implementations set in the jest.mock factory, so the
    // fake pool factory is (re)installed per test.
    (knex as unknown as jest.Mock).mockImplementation((config: unknown) => {
      const instance = makeFakeKnex(config);
      mockInstances.push(instance);
      return instance;
    });
  });

  afterEach(async () => {
    await disconnectAll();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("lifecycle (AC-3)", () => {
    it("refuses to hand out a connection before connectAll() resolved", () => {
      expect(() => db("core")).toThrow(DatabaseNotConnectedError);
      expect(() => db("erp")).toThrow(
        /Knex connection for "erp" has not been established/,
      );
    });

    it("builds one pool per key and proves each one answers", async () => {
      await connectAll();

      expect(mockInstances).toHaveLength(DB_KEYS.length);
      for (const instance of mockInstances) {
        expect(instance.raw).toHaveBeenCalledWith("SELECT 1");
      }
      for (const key of DB_KEYS) expect(db(key)).toBeDefined();
    });

    it("destroys every pool it opened and rethrows when one cannot connect", async () => {
      mockRawFails = true;

      await expect(connectAll()).rejects.toThrow("connection refused");

      expect(mockInstances).toHaveLength(DB_KEYS.length);
      for (const instance of mockInstances) {
        expect(instance.destroy).toHaveBeenCalled();
      }
      // Nothing half-open is left addressable — server.ts can exit(1).
      expect(() => db("core")).toThrow(DatabaseNotConnectedError);
    });

    it("destroys all four pools on disconnectAll()", async () => {
      await connectAll();
      await disconnectAll();

      for (const instance of mockInstances) {
        expect(instance.destroy).toHaveBeenCalledTimes(1);
      }
      expect(() => db("countdown")).toThrow(DatabaseNotConnectedError);
    });
  });

  describe("environment resolution (AC-4)", () => {
    it("resolves every key to one database when only SQL_DATABASE is set", async () => {
      await connectAll();

      expect(mockInstances).toHaveLength(DB_KEYS.length);
      for (let index = 0; index < DB_KEYS.length; index++) {
        expect(configOf(index).connection).toMatchObject({
          database: "one_database",
          user: "one_user",
          password: "one_password",
          host: "localhost",
          port: 5432,
          ssl: false,
        });
      }
    });

    it("lets a per-key variable override exactly one key", async () => {
      process.env.SQL_CORE_DATABASE = "core_only";
      process.env.SQL_CORE_USER = "core_user";

      await connectAll();

      const byKey = Object.fromEntries(
        DB_KEYS.map((key, index) => [key, configOf(index).connection]),
      ) as Record<DbKey, Record<string, unknown>>;

      expect(byKey.core).toMatchObject({
        database: "core_only",
        user: "core_user",
        // no SQL_CORE_PASSWORD: the shared value still applies
        password: "one_password",
      });
      for (const key of ["erp", "countdown"] as DbKey[]) {
        expect(byKey[key]).toMatchObject({ database: "one_database" });
      }
    });

    it("refuses to start when no database name is set at all", async () => {
      // `pg` would otherwise connect to a database named after the connecting
      // user — an env file still carrying the pre-D-8 spelling would come up
      // healthy and wrong. This is the mis-ordered-deploy scenario.
      delete process.env.SQL_DATABASE;

      await expect(connectAll()).rejects.toThrow(MissingDatabaseNameError);
      await expect(connectAll()).rejects.toThrow(
        /neither SQL_CORE_DATABASE nor SQL_DATABASE is set/,
      );
      // Nothing half-open survives the refusal.
      expect(() => db("core")).toThrow(DatabaseNotConnectedError);
    });

    it("accepts a per-key name as the only name", async () => {
      delete process.env.SQL_DATABASE;
      for (const key of DB_KEYS) {
        process.env[`SQL_${key.toUpperCase()}_DATABASE`] = `${key}_db`;
      }

      await connectAll();

      DB_KEYS.forEach((key, index) => {
        expect(configOf(index).connection).toMatchObject({
          database: `${key}_db`,
        });
      });
    });
  });

  describe("wrong-database guard (AC-6, AC-31)", () => {
    beforeEach(async () => {
      await connectAll();
    });

    it("throws when a table is queried on a connection that does not own it", () => {
      expect(() => db("countdown")("users")).toThrow(WrongDatabaseError);
      expect(() => db("countdown")("users")).toThrow(
        /"users" is owned by the "core" database/,
      );
      expect(() => db("erp")("companies")).toThrow(WrongDatabaseError);
    });

    it("sees through an alias and a schema qualifier", () => {
      expect(() => db("erp")("users as u")).toThrow(WrongDatabaseError);
      expect(() => db("erp")("users AS u")).toThrow(WrongDatabaseError);
      // The same alias with the keyword left out.
      expect(() => db("erp")("users u")).toThrow(WrongDatabaseError);
      expect(() => db("erp")("public.users")).toThrow(WrongDatabaseError);
      expect(() => db("erp")('"users"')).toThrow(WrongDatabaseError);
    });

    it("sees a generic call, which a naive grep does not", () => {
      // `db(k)<IRow>("users")` compiles to the same call; this is the shape
      // that hid the countdown findRecipients regression.
      expect(() => db("erp")<{ id: number }>("users")).toThrow(
        WrongDatabaseError,
      );
    });

    it("guards the instance-level table shortcuts too", () => {
      expect(() => db("erp").from("users")).toThrow(WrongDatabaseError);
      expect(() => db("erp").table("users")).toThrow(WrongDatabaseError);
      expect(() => db("core").from("users")).not.toThrow();
      // Still delegates when it lets the call through.
      expect(mockInstances[0]?.from).toHaveBeenCalledWith("users");
    });

    it("does not pretend to cover what it cannot see", () => {
      // Documented holes (see registry.ts): object aliases and casing. If any
      // of these ever starts throwing, the comment must be updated with it.
      expect(() => db("erp")({ c: "companies" })).not.toThrow();
      expect(() => db("erp")("COMPANIES")).not.toThrow();
    });

    it("lets a table through on its own key", () => {
      expect(() => db("core")("users")).not.toThrow();
      expect(() => db("erp")("products as p")).not.toThrow();
      expect(() => db("countdown")("countdown_documents")).not.toThrow();
    });

    it("never objects to a fanned-out or unknown table", () => {
      // `files` and `audit_logs` live in several databases (AC-2); knex's own
      // bookkeeping tables live in all of them.
      for (const key of DB_KEYS) {
        expect(() => db(key)("files")).not.toThrow();
        expect(() => db(key)("audit_logs")).not.toThrow();
        expect(() => db(key)("knex_migrations")).not.toThrow();
      }
    });

    it("carries the key into a transaction, so a cross-key trx throws", async () => {
      await expect(
        db("erp").transaction(async (trx) => trx("users")),
      ).rejects.toThrow(WrongDatabaseError);

      await expect(
        db("erp").transaction(async (trx) => trx("products")),
      ).resolves.toBeDefined();
    });

    it("carries the key into the callback-less transaction form too", async () => {
      // `const trx = await db(k).transaction()` resolves to a bare handle that
      // would otherwise escape the Proxy entirely.
      const trx = await db("erp").transaction();

      expect(() => trx("users")).toThrow(WrongDatabaseError);
      expect(() => trx("products")).not.toThrow();
    });

    it("logs, never throws, when raw SQL names a foreign table", () => {
      const consoleWarn = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      try {
        // The apply trap cannot see inside raw SQL, so the query event is the
        // only signal — a documented limitation, logged rather than enforced.
        for (const listener of queryListeners) {
          listener({ method: "raw", sql: 'select 1 from "companies"' });
        }
        expect(consoleWarn).toHaveBeenCalledWith(
          expect.stringContaining('raw query on "erp" mentions "companies"'),
        );
        // A builder query carries its verb and is already guarded upstream.
        consoleWarn.mockClear();
        for (const listener of queryListeners) {
          listener({ method: "select", sql: 'select 1 from "companies"' });
        }
        expect(consoleWarn).not.toHaveBeenCalled();
      } finally {
        consoleWarn.mockRestore();
      }
    });

    it("logs instead of throwing in production", () => {
      const previous = process.env.NODE_ENV;
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      process.env.NODE_ENV = "production";
      try {
        expect(() => db("countdown")("users")).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('"users" is owned by the "core" database'),
        );
      } finally {
        process.env.NODE_ENV = previous;
        consoleError.mockRestore();
      }
    });
  });

  describe("pool budget (AC-44)", () => {
    it("stays inside the ratified ceiling with the ratified split", () => {
      expect(POOL_MAX).toEqual({
        core: 12,
        erp: 15,
        countdown: 5,
        nodefiles: 5,
      });
      const sum = Object.values(POOL_MAX).reduce((a, b) => a + b, 0);
      expect(sum).toBe(37);
      expect(sum).toBeLessThanOrEqual(POOL_BUDGET);
      expect(POOL_BUDGET).toBe(40);
    });

    it("gives the low-traffic key min 0 — idle connections are not free", async () => {
      await connectAll();
      const pools = DB_KEYS.map(
        (_key, index) =>
          (mockInstances[index]?.config as { pool: Record<string, number> })
            .pool,
      );
      const byKey = Object.fromEntries(
        DB_KEYS.map((key, index) => [key, pools[index]]),
      ) as Record<DbKey, Record<string, number>>;

      expect(byKey.core).toMatchObject({ min: 1, max: 12 });
      expect(byKey.erp).toMatchObject({ min: 1, max: 15 });
      expect(byKey.countdown).toMatchObject({ min: 0, max: 5 });
      expect(byKey.nodefiles).toMatchObject({ min: 0, max: 5 });
    });

    it("logs the budget exactly once, however often connectAll is called", async () => {
      const consoleInfo = jest
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      try {
        await connectAll();
        await connectAll();

        const budgetLogs = consoleInfo.mock.calls.filter(
          (call) => call[0] === "[db] pool budget",
        );
        expect(budgetLogs).toHaveLength(1);
        expect(budgetLogs[0]).toEqual([
          "[db] pool budget",
          POOL_MAX,
          "sum",
          37,
        ]);
      } finally {
        consoleInfo.mockRestore();
      }
    });
  });
});
