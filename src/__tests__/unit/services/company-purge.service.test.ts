// @ts-nocheck
/**
 * `purgeCompany` — the one sanctioned door into the ledger (audit P2, T3, AC-8).
 *
 * The protection trigger makes `audit_logs` append-only in the database, so the
 * only thing standing between "a company can be deleted" and `P0001` is the
 * `mobius.audit_maintenance` setting this service turns on. Nothing about that
 * is visible in a green suite unless it is asserted here, statement by
 * statement — which is why these tests assert an **ordered log of every
 * statement**, not just "delete was called".
 *
 * The four load-bearing assertions, each mutation-checked (L-018):
 *
 * 1. **One ledger delete per distinct physical database — not per key.** The
 *    first version of this service looped `DB_KEYS` as §P2.7 sketches, and
 *    every real `DELETE /api/companies/:uuid` **hung forever**: P1 holds one
 *    ambient transaction per key on four different pooled backends, all four
 *    keys resolve to one database today, so `core`'s uncommitted delete of
 *    `audit_logs` blocked `erp`'s delete of the same rows while `core` itself
 *    waited on the client. No cycle, so no deadlock detector, so no timeout.
 *    Mocks cannot see a lock wait — what they *can* see is the loop shape, so
 *    these tests count the ledger deletes issued and pin them to the number of
 *    distinct databases the environment describes.
 * 2. Both settings are issued **before** any delete and **inside** the same
 *    transaction as the deletes. Drop `set_config('mobius.audit_maintenance'…)`
 *    and the sequence test goes red — in production it would go red as a failed
 *    company deletion.
 * 3. Both are `set_config(…, true)` — `is_local`. Flip it to `false` and the
 *    setting becomes *session*-scoped: the pooled connection carries
 *    maintenance mode (append-only OFF, capture OFF) into whatever request it
 *    serves next. That is a security hole, and only the exact SQL text can see
 *    it, so the expected sequence pins the literal string.
 * 4. The ledger delete is **explicit and first**. `audit_logs."companyId"`
 *    carries no foreign key (ruling R-B), so nothing cascades those rows away:
 *    deleting the company without this statement orphans the whole trail.
 *
 * The transaction mock below emulates knex's commit/rollback so "a failure
 * rolls everything back" is expressible: a callback that throws logs `rollback`
 * and never `commit`, and no statement is ever issued outside a begin/end pair.
 * What a mock cannot prove — that Postgres honours the setting, that the
 * trigger lets the delete through, and that the request returns at all — is
 * T5's `repos/tests/api/audit-capture.test.ts` and the live HTTP delete.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";
import { DB_KEYS } from "../../../database/keys";

const COMPANY_ID = 42;

const MAINTENANCE_SQL =
  "select set_config('mobius.audit_maintenance', 'on', true)";
const SKIP_SQL = "select set_config('mobius.audit_skip', 'on', true)";

/** Every environment variable `connectionFor` reads, saved and restored. */
const ENV_VARS = [
  "SQL_HOST",
  "SQL_PORT",
  "SQL_DATABASE",
  ...DB_KEYS.map((key) => `SQL_${key.toUpperCase()}_DATABASE`),
];

/** Every statement issued, across every key, in the order it was issued. */
let log;
/** The table-aware mock behind each key, for fixtures and where-call captures. */
let mocks;
/** What `db(key)` hands out: the mock, with delete/raw/transaction traced. */
let facades;
let savedEnv;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key) => facades[key],
}));

import {
  purgeCompany,
  purgeTargets,
} from "../../../services/company-purge.service";

/** Make one key's mock trace itself into the shared ordered log. */
const traced = (key, mock) => {
  const inner = mock.knexMock;

  const facade = jest.fn((table) => {
    const builder = inner(table);
    const runDelete = builder.delete;
    builder.delete = jest.fn(() => {
      log.push({ key, op: "delete", table });
      return runDelete();
    });
    builder.del = builder.delete;
    return builder;
  });

  facade.raw = jest.fn((sql) => {
    log.push({ key, op: "raw", sql });
    return sql;
  });

  facade.transaction = jest.fn(async (callback) => {
    log.push({ key, op: "begin" });
    try {
      const result = await callback(facade);
      log.push({ key, op: "commit" });
      return result;
    } catch (error) {
      log.push({ key, op: "rollback" });
      throw error;
    }
  });

  return facade;
};

/** The ordered log, flattened to comparable strings, for one key. */
const sequenceOf = (key) =>
  log
    .filter((entry) => entry.key === key)
    .map((entry) =>
      entry.op === "raw"
        ? `raw ${entry.sql}`
        : entry.op === "delete"
          ? `delete ${entry.table}`
          : entry.op,
    );

/** Which keys issued a `delete from audit_logs`, in order. One per database. */
const ledgerDeletes = () =>
  log
    .filter((entry) => entry.op === "delete" && entry.table === "audit_logs")
    .map((entry) => entry.key);

/** Give each key its own database — the world after the split's cutover. */
const givenOneDatabasePerKey = () => {
  for (const key of DB_KEYS) {
    process.env[`SQL_${key.toUpperCase()}_DATABASE`] = `mobius_${key}`;
  }
};

beforeEach(() => {
  savedEnv = Object.fromEntries(
    ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of ENV_VARS) delete process.env[name];
  // The world as deployed today: every key on one physical database.
  process.env.SQL_HOST = "localhost";
  process.env.SQL_PORT = "5432";
  process.env.SQL_DATABASE = "traffic_production";

  log = [];
  mocks = {};
  facades = {};
  for (const key of DB_KEYS) {
    mocks[key] = createTableAwareKnexMock();
    // Nothing to delete anywhere until a test says otherwise.
    mocks[key].fixture("audit_logs").deleteCount = 0;
    mocks[key].fixture("companies").deleteCount = 0;
    facades[key] = traced(key, mocks[key]);
  }
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  jest.clearAllMocks();
});

describe("purgeTargets — one key per physical database", () => {
  it("collapses to core alone while every key shares one database", () => {
    expect(purgeTargets()).toStrictEqual(["core"]);
  });

  it("returns every key once each key has its own database", () => {
    givenOneDatabasePerKey();
    expect(purgeTargets()).toStrictEqual([...DB_KEYS]);
  });

  it("groups the keys that share a database, keeping the first as its voice", () => {
    // countdown moved out on its own; erp and nodefiles still share core's.
    process.env.SQL_COUNTDOWN_DATABASE = "mobius_countdown";
    expect(purgeTargets()).toStrictEqual(["core", "countdown"]);
  });

  it("groups two keys that name the same database, however they got there", () => {
    // A half-done cutover: erp still points at core's database by name.
    givenOneDatabasePerKey();
    process.env.SQL_ERP_DATABASE = "mobius_core";
    expect(purgeTargets()).toStrictEqual(["core", "countdown", "nodefiles"]);
  });
});

describe("purgeCompany — one ledger delete per database (the hang, regressed)", () => {
  it("issues exactly ONE ledger delete while every key shares one database", async () => {
    await purgeCompany(COMPANY_ID);

    // Two deletes of the same rows, from two pooled backends, inside a request
    // that holds both transactions open until it answers = a permanent block
    // that Postgres cannot detect. One database, one delete.
    expect(ledgerDeletes()).toStrictEqual(["core"]);
    expect(log.filter((entry) => entry.op === "begin")).toHaveLength(1);

    for (const key of DB_KEYS.filter((k) => k !== "core")) {
      expect(facades[key]).not.toHaveBeenCalled();
      expect(facades[key].transaction).not.toHaveBeenCalled();
      expect(sequenceOf(key)).toStrictEqual([]);
    }
  });

  it("issues one ledger delete per database once the split gives each key one", async () => {
    givenOneDatabasePerKey();

    await purgeCompany(COMPANY_ID);

    expect(ledgerDeletes()).toStrictEqual([...DB_KEYS]);
    expect(log.filter((entry) => entry.op === "begin")).toHaveLength(
      DB_KEYS.length,
    );
    // Still exactly one company delete: `companies` lives in core.
    expect(
      log.filter(
        (entry) => entry.op === "delete" && entry.table === "companies",
      ),
    ).toHaveLength(1);
  });

  it("issues one ledger delete per database when two keys share one", async () => {
    process.env.SQL_COUNTDOWN_DATABASE = "mobius_countdown";

    await purgeCompany(COMPANY_ID);

    expect(ledgerDeletes()).toStrictEqual(["core", "countdown"]);
  });
});

describe("purgeCompany — maintenance mode and statement order", () => {
  it("sets both settings, transaction-locally, before any delete", async () => {
    await purgeCompany(COMPANY_ID);

    expect(sequenceOf("core")).toStrictEqual([
      "begin",
      `raw ${MAINTENANCE_SQL}`,
      `raw ${SKIP_SQL}`,
      "delete audit_logs",
      "delete companies",
      "commit",
    ]);
  });

  it("sets both settings in every transaction it opens, not just the first", async () => {
    givenOneDatabasePerKey();

    await purgeCompany(COMPANY_ID);

    for (const key of DB_KEYS.filter((k) => k !== "core")) {
      expect(sequenceOf(key)).toStrictEqual([
        "begin",
        `raw ${MAINTENANCE_SQL}`,
        `raw ${SKIP_SQL}`,
        "delete audit_logs",
        "commit",
      ]);
    }
  });

  it("uses is_local = true so the settings cannot outlive the transaction", async () => {
    givenOneDatabasePerKey();

    await purgeCompany(COMPANY_ID);

    const settings = log.filter((entry) => entry.op === "raw");
    expect(settings).toHaveLength(DB_KEYS.length * 2);
    for (const entry of settings) {
      // The third argument of set_config is `is_local`. `false` would leave
      // maintenance mode on for the pooled connection's next user.
      expect(entry.sql).toMatch(
        /^select set_config\('mobius\.audit_(maintenance|skip)', 'on', true\)$/,
      );
    }
  });

  it("issues every statement inside a transaction — none before begin", async () => {
    givenOneDatabasePerKey();

    await purgeCompany(COMPANY_ID);

    let open = false;
    for (const entry of log) {
      if (entry.op === "begin") {
        expect(open).toBe(false);
        open = true;
        continue;
      }
      if (entry.op === "commit" || entry.op === "rollback") {
        open = false;
        continue;
      }
      expect(open).toBe(true);
    }
    expect(open).toBe(false);
  });
});

describe("purgeCompany — what it deletes", () => {
  it("deletes the company's ledger rows explicitly, scoped to that company", async () => {
    await purgeCompany(COMPANY_ID);

    expect(mocks.core.writeCounts("audit_logs")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(mocks.core.fixture("audit_logs").whereCalls).toStrictEqual([
      [{ companyId: COMPANY_ID }],
    ]);
  });

  it("deletes the company only on core, and only after its ledger rows", async () => {
    givenOneDatabasePerKey();

    await purgeCompany(COMPANY_ID);

    expect(mocks.core.writeCounts("companies")).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(mocks.core.fixture("companies").whereCalls).toStrictEqual([
      [{ id: COMPANY_ID }],
    ]);

    const core = sequenceOf("core");
    expect(core.indexOf("delete audit_logs")).toBeLessThan(
      core.indexOf("delete companies"),
    );

    for (const key of DB_KEYS.filter((k) => k !== "core")) {
      expect(mocks[key].writeCounts("companies")).toStrictEqual({
        insert: 0,
        update: 0,
        delete: 0,
      });
    }
  });

  it("writes nothing to the ledger — the purge leaves no row of its own (P5)", async () => {
    givenOneDatabasePerKey();

    await purgeCompany(COMPANY_ID);

    for (const key of DB_KEYS) {
      expect(mocks[key].writeCounts("audit_logs").insert).toBe(0);
    }
  });

  it("reports the rows it removed, summed across every database", async () => {
    givenOneDatabasePerKey();
    mocks.core.fixture("audit_logs").deleteCount = 11;
    mocks.core.fixture("companies").deleteCount = 1;
    mocks.erp.fixture("audit_logs").deleteCount = 4;

    await expect(purgeCompany(COMPANY_ID)).resolves.toStrictEqual({
      companyDeleted: true,
      ledgerRowsDeleted: 15,
    });
  });

  it("reports companyDeleted = false when no such company exists", async () => {
    await expect(purgeCompany(COMPANY_ID)).resolves.toStrictEqual({
      companyDeleted: false,
      ledgerRowsDeleted: 0,
    });
  });
});

describe("purgeCompany — failure", () => {
  it("rolls the transaction back when the company delete fails", async () => {
    const boom = new Error("deadlock detected");
    const build = facades.core.getMockImplementation();
    facades.core.mockImplementation((table) => {
      const builder = build(table);
      if (table === "companies") {
        builder.delete = jest.fn(() => {
          log.push({ key: "core", op: "delete", table });
          return Promise.reject(boom);
        });
      }
      return builder;
    });

    await expect(purgeCompany(COMPANY_ID)).rejects.toThrow("deadlock detected");

    // Rolled back, never committed — the ledger rows deleted a statement
    // earlier come back with it, and so do both transaction-local settings.
    expect(sequenceOf("core")).toStrictEqual([
      "begin",
      `raw ${MAINTENANCE_SQL}`,
      `raw ${SKIP_SQL}`,
      "delete audit_logs",
      "delete companies",
      "rollback",
    ]);
  });

  it("stops at the failing database and never opens the next one", async () => {
    givenOneDatabasePerKey();
    const boom = new Error("deadlock detected");
    const build = facades.core.getMockImplementation();
    facades.core.mockImplementation((table) => {
      const builder = build(table);
      if (table === "companies") {
        builder.delete = jest.fn(() => Promise.reject(boom));
      }
      return builder;
    });

    await expect(purgeCompany(COMPANY_ID)).rejects.toThrow("deadlock detected");

    for (const key of DB_KEYS.filter((k) => k !== "core")) {
      expect(sequenceOf(key)).toStrictEqual([]);
    }
  });

  it("deletes nothing when maintenance mode cannot be set", async () => {
    const boom = new Error("permission denied to set parameter");
    facades.core.raw = jest.fn((sql) => {
      log.push({ key: "core", op: "raw", sql });
      throw boom;
    });

    await expect(purgeCompany(COMPANY_ID)).rejects.toThrow(
      "permission denied to set parameter",
    );

    expect(sequenceOf("core")).toStrictEqual([
      "begin",
      `raw ${MAINTENANCE_SQL}`,
      "rollback",
    ]);
    expect(mocks.core.writeCounts("audit_logs").delete).toBe(0);
    expect(mocks.core.writeCounts("companies").delete).toBe(0);
  });
});
