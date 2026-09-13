/**
 * The connection registry: lifecycle, env resolution, the wrong-database guard
 * and the pool budget (AC-3, AC-4, AC-6, AC-31, AC-44; db-per-company AC-17,
 * AC-18 and the D-13 dedupe).
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
  fn: { now: jest.Mock };
  schema: { hasTable: jest.Mock; hasColumn: jest.Mock };
  /** Every transaction this pool opened, in order (AC-4 counts them). */
  opened: FakeTrx[];
  config: unknown;
};

const mockInstances: FakeKnex[] = [];
let mockRawFails = false;

type QueryListener = (query: { sql: string; method?: string }) => void;
const queryListeners: QueryListener[] = [];

type Fulfilled = ((value: unknown) => unknown) | undefined | null;
type Rejected = ((reason: unknown) => unknown) | undefined | null;

/**
 * A stand-in for a knex query builder: awaitable, bindable to a transaction,
 * and honest about which of the two it actually ran on.
 *
 * `then` and `transacting` live on the PROTOTYPE, exactly as knex's do
 * (`builder-interface-augmenter.js:23,69`). That is load-bearing: the ambient
 * facade works by installing an *own* `then` that shadows the prototype one, so
 * `hasOwnProperty("then")` is the difference between a plain builder and a
 * deferred one — and the AC-3 "inert until armed" case asserts exactly that.
 */
type FakeBuilder = {
  table: unknown;
  /** What `transacting()` was called with. `null` ⇒ it ran on the pool. */
  boundTo: unknown;
  then: (onFulfilled?: Fulfilled, onRejected?: Rejected) => unknown;
  transacting: (trx: unknown) => FakeBuilder;
};

const builderPrototype = {
  then(this: FakeBuilder, onFulfilled?: Fulfilled, onRejected?: Rejected) {
    return Promise.resolve({
      table: this.table,
      boundTo: this.boundTo,
    }).then(onFulfilled, onRejected);
  },
  transacting(this: FakeBuilder, trx: unknown): FakeBuilder {
    this.boundTo = trx;
    return this;
  },
};

const makeBuilder = (table: unknown): FakeBuilder =>
  Object.assign(Object.create(builderPrototype) as FakeBuilder, {
    table,
    boundTo: null,
  });

/** `knex.raw(...)` — a thenable with `transacting`, like the real Raw. */
type FakeRaw = {
  sql: unknown;
  bindings: unknown;
  boundTo: unknown;
  then: (onFulfilled?: Fulfilled, onRejected?: Rejected) => unknown;
  transacting: (trx: unknown) => FakeRaw;
};

const rawPrototype = {
  then(this: FakeRaw, onFulfilled?: Fulfilled, onRejected?: Rejected) {
    // Built lazily so an unawaited raw never becomes an unhandled rejection.
    return (
      mockRawFails
        ? Promise.reject(new Error("connection refused"))
        : Promise.resolve({ rows: [] })
    ).then(onFulfilled, onRejected);
  },
  transacting(this: FakeRaw, trx: unknown): FakeRaw {
    this.boundTo = trx;
    return this;
  },
};

const makeRaw = (sql: unknown, bindings: unknown): FakeRaw =>
  Object.assign(Object.create(rawPrototype) as FakeRaw, {
    sql,
    bindings,
    boundTo: null,
  });

let trxCounter = 0;

/**
 * The callback-less `transaction()` handle: callable (so the guard still has
 * something to trap), and carrying the members the middleware and the facade
 * drive — `raw`, `commit`, `rollback`, `isCompleted`, `transaction`.
 */
type FakeTrx = ((table?: unknown) => FakeBuilder) & {
  id: number;
  completed: boolean;
  rawCalls: unknown[][];
  /** Nested `trx.transaction(...)` handles — savepoints, in knex 3.1. */
  savepoints: FakeTrx[];
  raw: jest.Mock;
  commit: jest.Mock;
  rollback: jest.Mock;
  isCompleted: jest.Mock;
  transaction: jest.Mock;
};

const makeFakeTrx = (): FakeTrx => {
  const trx = ((table?: unknown) => makeBuilder(table)) as FakeTrx;
  trx.id = ++trxCounter;
  trx.completed = false;
  trx.rawCalls = [];
  trx.savepoints = [];
  trx.raw = jest.fn((...args: unknown[]) => {
    trx.rawCalls.push(args);
    return Promise.resolve({ rows: [] });
  }) as jest.Mock;
  trx.commit = jest.fn(() => {
    trx.completed = true;
    return Promise.resolve();
  }) as jest.Mock;
  trx.rollback = jest.fn(() => {
    trx.completed = true;
    return Promise.resolve();
  }) as jest.Mock;
  trx.isCompleted = jest.fn(() => trx.completed) as jest.Mock;
  // knex 3.1 turns this into a SAVEPOINT on `trx`, not a second transaction
  // (`execution/transaction.js:293-295`); the fake keeps the same shape so the
  // savepoint handle is distinguishable from its parent.
  trx.transaction = jest.fn(function (this: unknown, callback?: unknown) {
    if (this !== trx) {
      return Promise.reject(
        new Error("transaction() called without its handle as `this`"),
      );
    }
    const savepoint = makeFakeTrx();
    trx.savepoints.push(savepoint);
    if (typeof callback !== "function") return Promise.resolve(savepoint);
    return Promise.resolve(
      (callback as (t: Knex.Transaction) => unknown)(
        savepoint as unknown as Knex.Transaction,
      ),
    );
  }) as jest.Mock;
  return trx;
};

const makeFakeKnex = (config: unknown): FakeKnex => {
  const instance = ((table?: unknown) => makeBuilder(table)) as FakeKnex;
  instance.config = config;
  instance.opened = [];
  instance.raw = jest.fn((sql?: unknown, bindings?: unknown) =>
    makeRaw(sql, bindings),
  ) as jest.Mock;
  instance.destroy = jest.fn(() => Promise.resolve()) as jest.Mock;
  instance.from = jest.fn((table?: unknown) => makeBuilder(table)) as jest.Mock;
  instance.table = jest.fn((table?: unknown) =>
    makeBuilder(table),
  ) as jest.Mock;
  // Real knex exposes `fn` as a getter and `schema` as a plain member; neither
  // is a function, so both Proxies hand them out untouched. The ambient facade
  // MUST NOT defer them — see the `fn.now()` and `schema` cases below.
  instance.fn = { now: jest.fn(() => ({ sql: "CURRENT_TIMESTAMP" })) };
  instance.schema = {
    hasTable: jest.fn(() => Promise.resolve(true)),
    hasColumn: jest.fn(() => Promise.resolve(true)),
  };
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
    const trx = makeFakeTrx();
    instance.opened.push(trx);
    // Knex supports both shapes: with a callback it runs it, without one it
    // resolves to a bare handle the caller drives itself.
    if (typeof callback !== "function") return Promise.resolve(trx);
    return Promise.resolve(
      (callback as (t: Knex.Transaction) => unknown)(
        trx as unknown as Knex.Transaction,
      ),
    );
  }) as jest.Mock;
  return instance;
};

jest.mock("knex", () => ({ __esModule: true, knex: jest.fn() }));

import { knex } from "knex";
import {
  db,
  connectAll,
  disconnectAll,
  CORE_POOL_MAX,
  POOL_BUDGET,
  DatabaseNotConnectedError,
  WrongDatabaseError,
  physicalKeyOf,
  withTenantTarget,
} from "../../../database/registry";
import { MissingDatabaseNameError } from "../../../database/env";
import { DB_KEYS, DbKey } from "../../../database/keys";
import {
  finishAuditRequest,
  getAuditState,
  withAuditContext,
  type AuditRequestState,
} from "../../../database/audit-context";

const DB_ENV_VARS = [
  "SQL_DATABASE",
  "SQL_USER",
  "SQL_PASSWORD",
  "SQL_HOST",
  "SQL_PORT",
  "SQL_CORE_DATABASE",
  "SQL_CORE_USER",
  "SQL_CORE_PASSWORD",
  "SQL_TENANT_DATABASE",
  "SQL_TENANT_USER",
  "SQL_TENANT_PASSWORD",
];

/** A second physical database, as a tenant target of its own would be. */
const ownTenantTarget = (): { physicalKey: "tenant:1"; instance: FakeKnex } => ({
  physicalKey: "tenant:1",
  instance: makeFakeKnex({ connection: { database: "tenant_one" } }),
});

const asTarget = (target: { physicalKey: "tenant:1"; instance: FakeKnex }) =>
  target as unknown as Parameters<typeof withTenantTarget>[0];

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
      expect(() => db("tenant")).toThrow(
        /Knex connection for "tenant" has not been established/,
      );
    });

    it("builds ONE pool for both planes and proves it answers (D-13, D-29)", async () => {
      await connectAll();

      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0]?.raw).toHaveBeenCalledWith("SELECT 1");
      for (const key of DB_KEYS) expect(db(key)).toBeDefined();
      // Both planes reach that one instance.
      db("core").from("users");
      db("tenant").from("products");
      expect(mockInstances[0]?.from).toHaveBeenCalledWith("users");
      expect(mockInstances[0]?.from).toHaveBeenCalledWith("products");
      expect(physicalKeyOf("core")).toBe("core");
      expect(physicalKeyOf("tenant")).toBe("core");
    });

    it("destroys every pool it opened and rethrows when one cannot connect", async () => {
      mockRawFails = true;

      await expect(connectAll()).rejects.toThrow("connection refused");

      expect(mockInstances).toHaveLength(1);
      for (const instance of mockInstances) {
        expect(instance.destroy).toHaveBeenCalled();
      }
      // Nothing half-open is left addressable — server.ts can exit(1).
      expect(() => db("core")).toThrow(DatabaseNotConnectedError);
    });

    it("destroys the pool on disconnectAll()", async () => {
      await connectAll();
      await disconnectAll();

      expect(mockInstances).toHaveLength(1);
      for (const instance of mockInstances) {
        expect(instance.destroy).toHaveBeenCalledTimes(1);
      }
      expect(() => db("tenant")).toThrow(DatabaseNotConnectedError);
    });
  });

  describe("environment resolution (AC-4)", () => {
    it("resolves both planes to one database when only SQL_DATABASE is set", async () => {
      await connectAll();

      expect(mockInstances).toHaveLength(1);
      for (let index = 0; index < mockInstances.length; index++) {
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

    it("lets the core variables override the shared ones, and reads no tenant variable", async () => {
      process.env.SQL_CORE_DATABASE = "core_only";
      process.env.SQL_CORE_USER = "core_user";
      // A tenant's connection comes from its registry row, never from env
      // (D-41). Every tenant-spelled variable is set, so a resolver that read
      // any of them — or a second pool built from them — shows up below.
      process.env.SQL_TENANT_DATABASE = "tenant_only";
      process.env.SQL_TENANT_USER = "tenant_user";
      process.env.SQL_TENANT_PASSWORD = "tenant_password";

      await connectAll();

      expect(mockInstances).toHaveLength(1);
      expect(configOf(0).connection).toStrictEqual({
        host: "localhost",
        port: 5432,
        database: "core_only",
        user: "core_user",
        // no SQL_CORE_PASSWORD: the shared value still applies
        password: "one_password",
        ssl: false,
      });
      expect(JSON.stringify(mockInstances.map((i) => i.config))).not.toMatch(
        /tenant_/,
      );
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

    it("accepts the core name as the only name", async () => {
      delete process.env.SQL_DATABASE;
      process.env.SQL_CORE_DATABASE = "core_db";

      await connectAll();

      expect(mockInstances).toHaveLength(1);
      expect(configOf(0).connection).toMatchObject({ database: "core_db" });
    });
  });

  describe("wrong-database guard (AC-6, AC-31)", () => {
    beforeEach(async () => {
      await connectAll();
    });

    it("throws when a table is queried on a connection that does not own it (AC-18)", () => {
      expect(() => db("tenant")("users")).toThrow(WrongDatabaseError);
      expect(() => db("tenant")("users")).toThrow(
        /"users" is owned by the "core" database/,
      );
      expect(() => db("tenant")("companies")).toThrow(WrongDatabaseError);
      // Both directions, although both planes share one instance today.
      expect(() => db("core")("products")).toThrow(WrongDatabaseError);
      expect(() => db("core")("products")).toThrow(
        /"products" is owned by the "tenant" database/,
      );
      expect(() => db("core")("countdown_documents")).toThrow(
        WrongDatabaseError,
      );
    });

    it("sees through an alias and a schema qualifier", () => {
      expect(() => db("tenant")("users as u")).toThrow(WrongDatabaseError);
      expect(() => db("tenant")("users AS u")).toThrow(WrongDatabaseError);
      // The same alias with the keyword left out.
      expect(() => db("tenant")("users u")).toThrow(WrongDatabaseError);
      expect(() => db("tenant")("public.users")).toThrow(WrongDatabaseError);
      expect(() => db("tenant")('"users"')).toThrow(WrongDatabaseError);
    });

    it("sees a generic call, which a naive grep does not", () => {
      // `db(k)<IRow>("users")` compiles to the same call; this is the shape
      // that hid the countdown findRecipients regression.
      expect(() => db("tenant")<{ id: number }>("users")).toThrow(
        WrongDatabaseError,
      );
    });

    it("guards the instance-level table shortcuts too", () => {
      expect(() => db("tenant").from("users")).toThrow(WrongDatabaseError);
      expect(() => db("tenant").table("users")).toThrow(WrongDatabaseError);
      expect(() => db("core").from("users")).not.toThrow();
      // Still delegates when it lets the call through.
      expect(mockInstances[0]?.from).toHaveBeenCalledWith("users");
    });

    it("does not pretend to cover what it cannot see", () => {
      // Documented holes (see registry.ts): object aliases and casing. If any
      // of these ever starts throwing, the comment must be updated with it.
      expect(() => db("tenant")({ c: "companies" })).not.toThrow();
      expect(() => db("tenant")("COMPANIES")).not.toThrow();
    });

    it("lets a table through on its own key", () => {
      expect(() => db("core")("users")).not.toThrow();
      expect(() => db("tenant")("products as p")).not.toThrow();
      expect(() => db("tenant")("countdown_documents")).not.toThrow();
      expect(() => db("tenant")("nf_runs")).not.toThrow();
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
        db("tenant").transaction(async (trx) => trx("users")),
      ).rejects.toThrow(WrongDatabaseError);

      await expect(
        db("tenant").transaction(async (trx) => trx("products")),
      ).resolves.toBeDefined();
    });

    it("carries the key into the callback-less transaction form too", async () => {
      // `const trx = await db(k).transaction()` resolves to a bare handle that
      // would otherwise escape the Proxy entirely.
      const trx = await db("tenant").transaction();

      expect(() => trx("users")).toThrow(WrongDatabaseError);
      expect(() => trx("products")).not.toThrow();
    });

    it("logs, never throws, when raw SQL on a tenant target names a central table", () => {
      // The shared instance serves both planes, so no table is foreign to it
      // and it carries no listener.
      expect(queryListeners).toHaveLength(0);

      const target = ownTenantTarget();
      withTenantTarget(asTarget(target), () => {
        db("tenant");
        db("tenant");
      });
      // Attached once per instance, however often the plane is asked for.
      expect(target.instance.on).toHaveBeenCalledTimes(1);
      expect(queryListeners).toHaveLength(1);

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
          expect.stringContaining('raw query on "tenant" mentions "companies"'),
        );
        // A tenant table is not foreign to a tenant target.
        consoleWarn.mockClear();
        for (const listener of queryListeners) {
          listener({ method: "raw", sql: 'select 1 from "products"' });
        }
        expect(consoleWarn).not.toHaveBeenCalled();
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

    it("guards a scoped tenant target as `tenant`, and leaves `core` on the shared pool", () => {
      const target = ownTenantTarget();
      withTenantTarget(asTarget(target), () => {
        expect(physicalKeyOf("tenant")).toBe("tenant:1");
        expect(physicalKeyOf("core")).toBe("core");
        expect(() => db("tenant")("users")).toThrow(WrongDatabaseError);
        db("tenant").from("products");
        db("core").from("users");
      });
      expect(target.instance.from).toHaveBeenCalledWith("products");
      expect(target.instance.from).not.toHaveBeenCalledWith("users");
      expect(mockInstances[0]?.from).toHaveBeenCalledWith("users");
      expect(physicalKeyOf("tenant")).toBe("core");
    });

    it("logs instead of throwing in production", () => {
      const previous = process.env.NODE_ENV;
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      process.env.NODE_ENV = "production";
      try {
        expect(() => db("tenant")("users")).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('"users" is owned by the "core" database'),
        );
        expect(() => db("core")("products")).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('"products" is owned by the "tenant" database'),
        );
      } finally {
        process.env.NODE_ENV = previous;
        consoleError.mockRestore();
      }
    });
  });

  describe("pool budget (AC-44, AC-17)", () => {
    it("stays inside the ratified ceiling with the model's constants", () => {
      expect(CORE_POOL_MAX).toBe(10);
      expect(POOL_BUDGET).toBe(40);
      expect(CORE_POOL_MAX).toBeLessThanOrEqual(POOL_BUDGET);
    });

    it("sizes the one shared instance with the core pool — min 1, max CORE_POOL_MAX (D-30)", async () => {
      await connectAll();

      expect(mockInstances).toHaveLength(1);
      expect(
        (mockInstances[0]?.config as { pool: Record<string, number> }).pool,
      ).toMatchObject({ min: 1, max: CORE_POOL_MAX });
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
          { core: CORE_POOL_MAX },
          "of",
          POOL_BUDGET,
        ]);
      } finally {
        consoleInfo.mockRestore();
      }
    });
  });

  /**
   * The ambient (per-request) transaction facade — audit P1 track T2.
   *
   * Everything above this block runs with NO audit state and is therefore the
   * "P1 is inert until armed" evidence in itself: not one of those cases was
   * edited for this track. If one ever needs editing, `db()`'s condition is
   * wrong, not the test.
   */
  describe("ambient audit facade (AC-3, AC-4, AC-5, AC-9)", () => {
    /** Both planes reach the one shared instance until tenant pools exist. */
    const instanceOf = (key: DbKey): FakeKnex => {
      const instance = mockInstances[0];
      if (!instance) throw new Error(`no fake pool for "${key}"`);
      return instance;
    };

    const armedState = (): AuditRequestState => {
      const state = getAuditState();
      if (!state) throw new Error("expected an armed audit state");
      return state;
    };

    /** An armed, mutating state — what `authenticate` produces in T3. */
    const withArmed = <T>(
      fn: (state: AuditRequestState) => Promise<T>,
    ): Promise<T> =>
      withAuditContext({ source: "script", username: "audit-test" }, () =>
        fn(armedState()),
      );

    const hasOwnThen = (value: unknown): boolean =>
      Object.prototype.hasOwnProperty.call(value, "then");

    beforeEach(async () => {
      await connectAll();
    });

    describe("inert until armed (AC-3, AC-5)", () => {
      it("hands out the plain facade and opens nothing outside a request", async () => {
        const tenant = instanceOf("tenant");

        expect(db("tenant")).toBe(db("tenant"));
        const builder = db("tenant")("products") as unknown as FakeBuilder;
        // No own `then` ⇒ nothing was deferred: this is the plain builder knex
        // would have returned before P1 existed.
        expect(hasOwnThen(builder)).toBe(false);

        await builder;

        expect(builder.boundTo).toBeNull();
        expect(tenant.transaction).not.toHaveBeenCalled();
        expect(tenant.opened).toHaveLength(0);
      });

      it.each([
        ["unarmed", (state: AuditRequestState) => (state.armed = false)],
        ["detached", (state: AuditRequestState) => (state.detached = true)],
        [
          "non-mutating",
          (state: AuditRequestState) => (state.mutating = false),
        ],
      ])("stays plain for a %s state", async (_label, disarm) => {
        const tenant = instanceOf("tenant");

        await withArmed(async (state) => {
          disarm(state);
          const builder = db("tenant")("products") as unknown as FakeBuilder;
          expect(hasOwnThen(builder)).toBe(false);
          await builder;
          expect(builder.boundTo).toBeNull();
          expect(state.trx.size).toBe(0);
        });

        expect(tenant.transaction).not.toHaveBeenCalled();
        expect(tenant.opened).toHaveLength(0);
      });

      it("never binds a builder awaited after the response finished", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          // Built while armed — it carries the deferring `then`.
          const late = db("tenant")("products") as unknown as FakeBuilder;
          expect(hasOwnThen(late)).toBe(true);

          await finishAuditRequest(true);
          await late;

          // A late query must reach the pool, never a closed transaction.
          expect(late.boundTo).toBeNull();
          expect(tenant.opened).toHaveLength(0);
        });
      });
    });

    describe("one transaction per key, opened on first await (AC-4)", () => {
      it("runs an awaited query on the request's transaction, not the pool", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          expect(db("tenant")).not.toBe(db("core"));
          // Memoised per (state, key): a DAO calling `db(k)` per method must not
          // get a fresh Proxy each time.
          expect(db("tenant")).toBe(db("tenant"));

          const builder = db("tenant")("products") as unknown as FakeBuilder;
          // Nothing opens until the builder is awaited.
          expect(tenant.opened).toHaveLength(0);

          await builder;

          expect(tenant.opened).toHaveLength(1);
          expect(builder.boundTo).toBe(tenant.opened[0]);
        });
      });

      it("applies the audit setting once per transaction, with the contract JSON", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async (state) => {
          await db("tenant")("products");
          await db("tenant")("parts");

          const trx = tenant.opened[0];
          expect(tenant.opened).toHaveLength(1);
          expect(trx?.rawCalls).toHaveLength(1);
          const [sql, bindings] = trx?.rawCalls[0] ?? [];
          expect(sql).toBe("select set_config('mobius.audit', ?, true)");
          expect(JSON.parse(String((bindings as string[])[0]))).toStrictEqual({
            requestId: state.requestId,
            source: "script",
            route: null,
            action: null,
            userId: null,
            username: "audit-test",
            role: null,
            companyId: null,
            actorCompanyId: null,
            context: { ip: null, ua: null, route: null },
          });
        });
      });

      it("memoises the OPEN PROMISE, so two concurrent builders share one transaction", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          // Both builders reach `ensureTrx` before either transaction exists.
          // Memoising the resolved handle instead of the promise lets both open
          // one, and the request then writes through a transaction nobody
          // commits — invisible in every other test here.
          const first = db("tenant")("products") as unknown as FakeBuilder;
          const second = db("tenant")("parts") as unknown as FakeBuilder;
          await Promise.all([first, second]);

          expect(tenant.transaction).toHaveBeenCalledTimes(1);
          expect(tenant.opened).toHaveLength(1);
          expect(first.boundTo).toBe(tenant.opened[0]);
          expect(second.boundTo).toBe(tenant.opened[0]);
        });
      });

      it("shares ONE transaction between core and tenant on one physical database (D-13)", async () => {
        const shared = instanceOf("core");

        await withArmed(async (state) => {
          const products = db("tenant")("products") as unknown as FakeBuilder;
          const users = db("core")("users") as unknown as FakeBuilder;
          await Promise.all([products, users]);

          // Two transactions on one database is the self-blocking shape the
          // purge documents; one is what makes this state bit-identical to a
          // single connection.
          expect(shared.transaction).toHaveBeenCalledTimes(1);
          expect(shared.opened).toHaveLength(1);
          expect(products.boundTo).toBe(shared.opened[0]);
          expect(users.boundTo).toBe(shared.opened[0]);
          expect([...state.trx.keys()]).toEqual(["core"]);
          expect(shared.opened[0]?.rawCalls).toHaveLength(1);
        });
      });

      it("opens one transaction per physical database once tenant has its own", async () => {
        const core = instanceOf("core");
        const target = ownTenantTarget();

        await withTenantTarget(asTarget(target), () =>
          withArmed(async (state) => {
            const products = db("tenant")("products") as unknown as FakeBuilder;
            const users = db("core")("users") as unknown as FakeBuilder;
            await Promise.all([products, users]);

            expect(target.instance.opened).toHaveLength(1);
            expect(core.opened).toHaveLength(1);
            expect(products.boundTo).toBe(target.instance.opened[0]);
            expect(users.boundTo).toBe(core.opened[0]);
            expect([...state.trx.keys()].sort()).toEqual(["core", "tenant:1"]);
            // Both carry the setting; P2's trigger reads it per transaction.
            expect(target.instance.opened[0]?.rawCalls).toHaveLength(1);
            expect(core.opened[0]?.rawCalls).toHaveLength(1);
          }),
        );
      });

      it("keeps the ambient facade per physical target inside ONE request (D-114)", async () => {
        const core = instanceOf("core");
        const target = ownTenantTarget();

        await withArmed(async (state) => {
          // Same key, same request state, two physical targets: a facade cached
          // by key alone would hand the second call the first call's target.
          const before = db("tenant")("products") as unknown as FakeBuilder;
          await before;
          // Captured, not returned: an async function that returns a thenable
          // resolves it, and the test needs the builder itself.
          let inside: FakeBuilder | undefined;
          await withTenantTarget(asTarget(target), async () => {
            inside = db("tenant")("products") as unknown as FakeBuilder;
            await inside;
          });
          const after = db("tenant")("products") as unknown as FakeBuilder;
          await after;

          expect(core.opened).toHaveLength(1);
          expect(target.instance.opened).toHaveLength(1);
          expect(before.boundTo).toBe(core.opened[0]);
          expect(inside?.boundTo).toBe(target.instance.opened[0]);
          expect(after.boundTo).toBe(core.opened[0]);
          expect([...state.trx.keys()].sort()).toEqual(["core", "tenant:1"]);
        });
      });

      it("binds `raw` to the transaction as well as the builder", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          const raw = db("tenant").raw("select 1") as unknown as FakeRaw;
          await raw;

          expect(tenant.opened).toHaveLength(1);
          expect(raw.boundTo).toBe(tenant.opened[0]);
        });
      });
    });

    describe("members that must NOT be deferred", () => {
      it("hands out `fn` untouched — `fn.now()` is a value, not a promise", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          const helper = db("tenant").fn as unknown;
          expect(helper).toBe(tenant.fn);

          const now = db("tenant").fn.now() as unknown;

          // `nf-run.dao.ts:319` puts this straight into an update payload. A
          // lazily-bound `fn` would make it a promise and the write would store
          // garbage without failing.
          expect(now).toStrictEqual({ sql: "CURRENT_TIMESTAMP" });
          expect(now).not.toHaveProperty("then");
          expect(tenant.opened).toHaveLength(0);
        });
      });

      it("lets `schema` probes run on the pool, outside the ambient transaction", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          // `sales-order-lifecycle.dao.ts:136,139` and
          // `production-route.dao.ts:655`: read-only introspection, deliberately
          // exempt (see registry.ts). It must not drag a transaction open.
          expect(db("tenant").schema as unknown).toBe(tenant.schema);
          await expect(db("tenant").schema.hasTable("parts")).resolves.toBe(true);

          expect(tenant.opened).toHaveLength(0);
          expect(tenant.transaction).not.toHaveBeenCalled();
        });
      });
    });

    describe("the wrong-database guard still fires (AC-9)", () => {
      it("throws before anything is deferred, and opens no transaction", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          expect(() => db("tenant")("users")).toThrow(WrongDatabaseError);
          expect(() => db("core")("products")).toThrow(WrongDatabaseError);
          expect(() => db("tenant")("users as u")).toThrow(WrongDatabaseError);
          expect(() => db("tenant").from("users")).toThrow(WrongDatabaseError);
          expect(() => db("tenant")("products")).not.toThrow();

          expect(tenant.opened).toHaveLength(0);
        });
      });

      it("carries the key into the savepoint a DAO's own transaction becomes", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          await expect(
            db("tenant").transaction(async (trx) => trx("users")),
          ).rejects.toThrow(WrongDatabaseError);

          await expect(
            db("tenant").transaction(async (trx) => trx("products")),
          ).resolves.toBeDefined();

          // One real transaction; the DAO's own two are savepoints on it.
          expect(tenant.opened).toHaveLength(1);
          expect(tenant.opened[0]?.savepoints).toHaveLength(2);
        });
      });

      it("rolls an inner savepoint back without completing the request's transaction", async () => {
        const tenant = instanceOf("tenant");

        await withArmed(async () => {
          await db("tenant").transaction(async (trx) => {
            await trx.rollback();
          });

          const outer = tenant.opened[0];
          const savepoint = outer?.savepoints[0];
          // knex 3.1: nested rollback is `ROLLBACK TO SAVEPOINT`, so the outer
          // transaction survives and the middleware still decides its fate
          // (`execution/transaction.js:153,318`).
          expect(savepoint?.rollback).toHaveBeenCalledTimes(1);
          expect(outer?.rollback).not.toHaveBeenCalled();
          expect(outer?.isCompleted()).toBe(false);
        });
      });
    });
  });
});
