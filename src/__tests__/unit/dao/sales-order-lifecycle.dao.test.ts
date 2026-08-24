// @ts-nocheck
/**
 * SalesOrderLifecycleDAO — AC-14..AC-18 and AC-21.
 *
 * The invariants guarded here are the ones no HTTP test can see:
 *   - the order row is re-read `FOR UPDATE` BEFORE the state guards run (R1);
 *   - a no-op writes NOTHING — not the four columns, not `updatedAt` (AC-3/AC-4);
 *   - each cascade carries its own `WHERE`, including the unfiltered reversal
 *     that mirrors Procusto's quirk (AC-14, AC-16, AC-17);
 *   - the cascade update is issued on the TRANSACTION handle, so a failing OP
 *     update rolls the order row back with it (AC-21, R3).
 *
 * The table-aware knex mock is sales-order-approval.dao.test.ts's, extended
 * with `forUpdate`, the null predicates and an update that resolves to a row
 * count. `transaction` hands the callback a DISTINCT trx object whose captures
 * are only published (as `committed`) when the callback resolves — a discarded
 * set is the mock's rollback.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

let seeds; // { [table]: { firstRows, updateCount, updateThrows } }
let bare; // captures issued on the bare knex handle
let committed; // captures of the last COMMITTED transaction (undefined = rolled back)

const makeBuilder = (table, captures) => {
  const seed = seeds[table] ?? (seeds[table] = {});
  const c = captures[table] ?? (captures[table] = {});
  const b = {};
  const record = (name) =>
    (b[name] = jest.fn((...args) => {
      (c[`${name}Calls`] ?? (c[`${name}Calls`] = [])).push(args);
      return b;
    }));
  [
    "select",
    "where",
    "whereNull",
    "whereNotNull",
    "forUpdate",
    "orderBy",
    "join",
    "leftJoin",
  ].forEach(record);
  b.first = jest.fn(() =>
    Promise.resolve((seed.firstRows ?? []).shift() ?? null),
  );
  b.update = jest.fn((data) => {
    if (seed.updateThrows) throw seed.updateThrows;
    (c.updateCaptures ?? (c.updateCaptures = [])).push(data);
    return b;
  });
  // Awaiting the builder yields the update's row count (knex's return value).
  b.then = (resolve, reject) =>
    Promise.resolve(seed.updateCount ?? 1).then(resolve, reject);
  return b;
};

let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { SalesOrderLifecycleDAO } from "../../../dao/sales-order/sales-order-lifecycle.dao";

const ORDER_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** The locked row `runTransition` re-reads before evaluating any guard. */
const lockedRow = (overrides = {}) => ({
  id: 7,
  uuid: ORDER_UUID,
  companyId: 3,
  orderDataId: 42,
  fulfilledAt: null,
  voidedAt: null,
  ...overrides,
});

/** A DAO whose post-commit DTO read is stubbed out — this file tests writes. */
const makeDao = () => {
  const dao = new SalesOrderLifecycleDAO();
  jest
    .spyOn(dao.salesOrderDAO, "getByUuid")
    .mockResolvedValue({ uuid: ORDER_UUID });
  return dao;
};

beforeEach(() => {
  seeds = {};
  bare = {};
  committed = undefined;
  mockKnex = jest.fn((table) => makeBuilder(table, bare));
  mockKnex.fn = { now: jest.fn(() => "NOW()") };
  mockKnex.raw = jest.fn((sql) => sql);
  mockKnex.schema = {
    hasTable: jest.fn(() => Promise.resolve(true)),
    hasColumn: jest.fn(() => Promise.resolve(true)),
  };
  mockKnex.transaction = async (cb) => {
    const pending = {};
    const trx = jest.fn((table) => makeBuilder(table, pending));
    trx.fn = { now: jest.fn(() => "NOW()") };
    trx.raw = jest.fn((sql) => sql);
    // A throw propagates with `committed` left untouched: the pending captures
    // are discarded, which is this mock's rollback.
    const result = await cb(trx);
    committed = pending;
    return result;
  };
  SalesOrderLifecycleDAO.resetCascadeProbe();
});

afterEach(() => jest.restoreAllMocks());

describe("SalesOrderLifecycleDAO.setFulfillment (AC-1, AC-2, AC-14, AC-15)", () => {
  it("stamps the pair, clears the reversal and cascades onto incomplete OPs", async () => {
    seeds.sales_orders = { firstRows: [lockedRow()] };
    seeds.production_orders = { updateCount: 2 };
    const dao = makeDao();

    const outcome = await dao.setFulfillment(7, "fulfill", "user@x");

    const order = committed.sales_orders.updateCaptures[0];
    expect(order).toEqual({
      fulfilledAt: "NOW()",
      fulfilledBy: "user@x",
      fulfillmentCancelledAt: null,
      fulfillmentCancelledBy: null,
      updatedAt: "NOW()",
    });
    const cascade = committed.production_orders.updateCaptures[0];
    expect(cascade).toEqual({
      completedAt: "NOW()",
      completedByUser: "user@x",
      completionCancelledAt: null,
      completionCancelledByUser: null,
      updatedAt: "NOW()",
    });
    // AC-14: already-completed OPs are untouched.
    expect(committed.production_orders.whereNullCalls).toEqual([
      ["completedAt"],
    ]);
    // L-009: the cascade names the tenant explicitly, so a cross-tenant write
    // is impossible from the WHERE clause alone — not only via the UNIQUE
    // constraint on sales_orders.orderDataId two tables away.
    expect(committed.production_orders.whereCalls).toEqual([
      ["orderDataId", 42],
      ["companyId", 3],
    ]);
    expect(outcome.changed).toBe(true);
    expect(outcome.productionOrdersAffected).toBe(2);
  });

  it("mirrors the pair on cancel and un-completes only completed OPs (AC-15)", async () => {
    seeds.sales_orders = {
      firstRows: [lockedRow({ fulfilledAt: new Date() })],
    };
    seeds.production_orders = { updateCount: 3 };
    const dao = makeDao();

    const outcome = await dao.setFulfillment(7, "cancel", "user@x");

    expect(committed.sales_orders.updateCaptures[0]).toEqual({
      fulfilledAt: null,
      fulfilledBy: null,
      fulfillmentCancelledAt: "NOW()",
      fulfillmentCancelledBy: "user@x",
      updatedAt: "NOW()",
    });
    expect(committed.production_orders.updateCaptures[0]).toEqual({
      completedAt: null,
      completedByUser: null,
      completionCancelledAt: "NOW()",
      completionCancelledByUser: "user@x",
      updatedAt: "NOW()",
    });
    expect(committed.production_orders.whereNotNullCalls).toEqual([
      ["completedAt"],
    ]);
    expect(outcome.productionOrdersAffected).toBe(3);
  });

  it("locks the order row before evaluating any guard (R1)", async () => {
    seeds.sales_orders = { firstRows: [lockedRow()] };
    const dao = makeDao();

    await dao.setFulfillment(7, "fulfill", "user@x");

    expect(committed.sales_orders.forUpdateCalls).toHaveLength(1);
    expect(bare.sales_orders).toBeUndefined();
  });
});

describe("SalesOrderLifecycleDAO no-ops write nothing (AC-3, AC-4)", () => {
  it("writes no column at all on a repeat fulfill", async () => {
    seeds.sales_orders = {
      firstRows: [lockedRow({ fulfilledAt: new Date() })],
    };
    const dao = makeDao();

    const outcome = await dao.setFulfillment(7, "fulfill", "user@x");

    expect(outcome.changed).toBe(false);
    expect(outcome.productionOrdersAffected).toBe(0);
    expect(committed.sales_orders.updateCaptures).toBeUndefined();
    expect(committed.production_orders).toBeUndefined();
  });

  it("writes no column at all when cancelling a never-fulfilled order", async () => {
    seeds.sales_orders = { firstRows: [lockedRow()] };
    const dao = makeDao();

    const outcome = await dao.setFulfillment(7, "cancel", "user@x");

    expect(outcome.changed).toBe(false);
    expect(committed.sales_orders.updateCaptures).toBeUndefined();
  });

  it("writes no column at all on a repeat void or an unnecessary reversal", async () => {
    seeds.sales_orders = {
      firstRows: [lockedRow({ voidedAt: new Date() }), lockedRow()],
    };
    const dao = makeDao();

    const repeat = await dao.setVoid(7, "void", "user@x", true);
    expect(repeat.changed).toBe(false);
    expect(committed.sales_orders.updateCaptures).toBeUndefined();

    const reversal = await dao.setVoid(7, "cancel", "user@x", true);
    expect(reversal.changed).toBe(false);
    expect(committed.sales_orders.updateCaptures).toBeUndefined();
  });
});

describe("SalesOrderLifecycleDAO.setVoid (AC-5, AC-6, AC-16, AC-17)", () => {
  it("refuses to void a fulfilled order and writes nothing (AC-6, D-1)", async () => {
    seeds.sales_orders = {
      firstRows: [lockedRow({ fulfilledAt: new Date() })],
    };
    const dao = makeDao();

    const outcome = await dao.setVoid(7, "void", "user@x", true);

    expect(outcome.rejected).toBe("ORDER_ALREADY_FULFILLED");
    expect(outcome.changed).toBe(false);
    expect(committed.sales_orders.updateCaptures).toBeUndefined();
    expect(committed.production_orders).toBeUndefined();
  });

  it("touches zero production orders without includeProductionOrders (AC-16)", async () => {
    seeds.sales_orders = { firstRows: [lockedRow()] };
    const dao = makeDao();

    const outcome = await dao.setVoid(7, "void", "user@x", false);

    expect(committed.sales_orders.updateCaptures[0]).toEqual({
      voidedAt: "NOW()",
      voidedBy: "user@x",
      voidCancelledAt: null,
      voidCancelledBy: null,
      updatedAt: "NOW()",
    });
    expect(committed.production_orders).toBeUndefined();
    expect(outcome.productionOrdersAffected).toBe(0);
  });

  it("voids every NON-VOIDED linked OP with includeProductionOrders (AC-16)", async () => {
    seeds.sales_orders = { firstRows: [lockedRow()] };
    seeds.production_orders = { updateCount: 2 };
    const dao = makeDao();

    const outcome = await dao.setVoid(7, "void", "user@x", true);

    expect(committed.production_orders.updateCaptures[0]).toEqual({
      voidedAt: "NOW()",
      voidedByUser: "user@x",
      voidCancelledAt: null,
      voidCancelledByUser: null,
      updatedAt: "NOW()",
    });
    expect(committed.production_orders.whereNullCalls).toEqual([["voidedAt"]]);
    expect(outcome.productionOrdersAffected).toBe(2);
  });

  it("clears voidedAt on EVERY linked OP on cancel, unfiltered (AC-17, Procusto parity quirk)", async () => {
    seeds.sales_orders = { firstRows: [lockedRow({ voidedAt: new Date() })] };
    seeds.production_orders = { updateCount: 4 };
    const dao = makeDao();

    const outcome = await dao.setVoid(7, "cancel", "user@x", true);

    expect(committed.production_orders.updateCaptures[0]).toEqual({
      voidedAt: null,
      voidedByUser: null,
      voidCancelledAt: "NOW()",
      voidCancelledByUser: "user@x",
      updatedAt: "NOW()",
    });
    // No state predicate at all: the reversal iterates all keys unfiltered
    // (UseCases.Pedidos/Editar.cs:117-123). Do not "fix" this.
    expect(committed.production_orders.whereNullCalls).toBeUndefined();
    expect(committed.production_orders.whereNotNullCalls).toBeUndefined();
    expect(outcome.productionOrdersAffected).toBe(4);
  });
});

describe("SalesOrderLifecycleDAO.cascadeAvailable (AC-18, L-007)", () => {
  it("is false when production_orders has no orderDataId column", async () => {
    mockKnex.schema.hasColumn = jest.fn(() => Promise.resolve(false));
    const dao = makeDao();

    expect(await dao.cascadeAvailable()).toBe(false);
  });

  it("skips the cascade entirely when the link is unavailable", async () => {
    mockKnex.schema.hasTable = jest.fn(() => Promise.resolve(false));
    seeds.sales_orders = { firstRows: [lockedRow()] };
    const dao = makeDao();

    const outcome = await dao.setFulfillment(7, "fulfill", "user@x");

    expect(outcome.changed).toBe(true);
    expect(committed.production_orders).toBeUndefined();
    expect(outcome.productionOrdersAffected).toBe(0);
  });

  it("probes the schema once and memoises the answer", async () => {
    const dao = makeDao();

    await dao.cascadeAvailable();
    await dao.cascadeAvailable();

    expect(mockKnex.schema.hasTable).toHaveBeenCalledTimes(1);
  });

  it("does NOT memoise a failed probe — a connection blip is not permanent", async () => {
    // A rejected promise cached for the process lifetime would make every
    // later PATCH /:uuid/fulfillment and /:uuid/void 500 inside their open
    // transaction until the API is restarted: one blip at boot, both lifecycle
    // verbs dead for the rest of the deployment.
    mockKnex.schema.hasTable = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(true);
    const dao = makeDao();

    await expect(dao.cascadeAvailable()).rejects.toThrow("ECONNREFUSED");

    expect(await dao.cascadeAvailable()).toBe(true);
    expect(mockKnex.schema.hasTable).toHaveBeenCalledTimes(2);
  });

  it("keeps serving transitions after a probe failure", async () => {
    mockKnex.schema.hasTable = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(true);
    seeds.sales_orders = { firstRows: [lockedRow(), lockedRow()] };
    seeds.production_orders = { updateCount: 1 };
    const dao = makeDao();

    await expect(dao.setFulfillment(7, "fulfill", "user@x")).rejects.toThrow(
      "ECONNREFUSED",
    );

    const outcome = await dao.setFulfillment(7, "fulfill", "user@x");
    expect(outcome.changed).toBe(true);
    expect(outcome.productionOrdersAffected).toBe(1);
  });
});

describe("SalesOrderLifecycleDAO cascade atomicity (AC-21, R3)", () => {
  it("rolls the order row back when the production-order update throws", async () => {
    seeds.sales_orders = { firstRows: [lockedRow()] };
    seeds.production_orders = { updateThrows: new Error("OP update failed") };
    const dao = makeDao();

    await expect(dao.setFulfillment(7, "fulfill", "user@x")).rejects.toThrow(
      "OP update failed",
    );

    // Nothing was committed: the discarded capture set IS the rollback.
    expect(committed).toBeUndefined();
    expect(bare.sales_orders).toBeUndefined();
  });
});

describe("SalesOrderLifecycleDAO auto-fulfillment support (AC-19)", () => {
  it("locks the pedido behind an order_data row and returns its aggregates", async () => {
    seeds.sales_orders = {
      firstRows: [
        {
          id: 7,
          uuid: ORDER_UUID,
          companyId: 3,
          quantity: 500,
          fulfilledAt: null,
        },
      ],
    };
    seeds.production_orders = {
      firstRows: [{ opCount: "2", incompleteCount: "0", opQuantitySum: "500" }],
    };
    const dao = makeDao();
    const trx = mockKnex;

    const candidate = await dao.findAutoFulfillCandidate(42, trx);

    expect(candidate).toEqual({
      id: 7,
      uuid: ORDER_UUID,
      // The tenant travels with the candidate so `stampFulfillment` can carry
      // it as a second predicate (L-009, symmetric with `cascade()`).
      companyId: 3,
      quantity: 500,
      fulfilledAt: null,
      opCount: 2,
      incompleteCount: 0,
      opQuantitySum: 500,
    });
    expect(bare.sales_orders.forUpdateCalls).toHaveLength(1);
    expect(bare.sales_orders.whereCalls).toEqual([["orderDataId", 42]]);
  });

  it("returns null when no pedido owns that order_data row", async () => {
    const dao = makeDao();

    expect(await dao.findAutoFulfillCandidate(42, mockKnex)).toBeNull();
  });

  it("stamps the four fulfillment columns on the CALLER's transaction, with no cascade", async () => {
    const dao = makeDao();

    await dao.stampFulfillment(7, 3, "system@x", mockKnex);

    expect(bare.sales_orders.updateCaptures[0]).toEqual({
      fulfilledAt: "NOW()",
      fulfilledBy: "system@x",
      fulfillmentCancelledAt: null,
      fulfillmentCancelledBy: null,
      updatedAt: "NOW()",
    });
    // A cross-tenant write must be impossible by READING the WHERE clause, not
    // by tracing a unique constraint two tables away (L-009).
    expect(bare.sales_orders.whereCalls).toEqual([
      ["id", 7],
      ["companyId", 3],
    ]);
    expect(bare.production_orders).toBeUndefined();
  });
});
