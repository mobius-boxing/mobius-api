// @ts-nocheck
/**
 * SalesOrderDAO.setApproval — AC-1..AC-4, AC-5 (the update-object key set),
 * AC-7, AC-11 and AC-12.
 *
 * The invariants guarded here are the ones a refactor is most likely to
 * "simplify" away:
 *   - the update object carries EXACTLY the machine's four columns + updatedAt
 *     (no read or write of the other machine, of fulfilledAt/voidedAt or of the
 *     credit-override pair — R-1/R-3/R-5);
 *   - the column update and the event insert are both issued on the TRANSACTION
 *     handle, never on the bare knex (R-7);
 *   - a failing event insert leaves nothing committed (AC-12).
 *
 * The table-aware knex mock is part.dao.test.ts's, extended so `transaction`
 * hands the callback a DISTINCT trx object whose captures are only published
 * (as `committed`) when the callback resolves — a discarded set is the mock's
 * rollback.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// ── Table-aware thenable knex mock, with a real trx boundary ────────────────
let seeds; // { [table]: { firstRows, rows, returningRows, insertThrows } }
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
  ["select", "where", "whereIn", "orderBy", "leftJoin", "join"].forEach(record);
  b.first = jest.fn(() =>
    Promise.resolve((seed.firstRows ?? []).shift() ?? null),
  );
  b.update = jest.fn((data) => {
    (c.updateCaptures ?? (c.updateCaptures = [])).push(data);
    return b;
  });
  b.insert = jest.fn((data) => {
    if (seed.insertThrows) throw seed.insertThrows;
    (c.insertCaptures ?? (c.insertCaptures = [])).push(data);
    return b;
  });
  b.returning = jest.fn(() => Promise.resolve(seed.returningRows ?? []));
  b.then = (resolve, reject) =>
    Promise.resolve(seed.rows ?? []).then(resolve, reject);
  return b;
};

let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { SalesOrderDAO } from "../../../dao/sales-order/sales-order.dao";

const APPROVAL_COLUMNS = {
  commercial: {
    approvedAt: "commercialApprovedAt",
    approvedBy: "commercialApprovedBy",
    cancelledAt: "commercialCancelledAt",
    cancelledBy: "commercialCancelledBy",
  },
  financial: {
    approvedAt: "financialApprovedAt",
    approvedBy: "financialApprovedBy",
    cancelledAt: "financialCancelledAt",
    cancelledBy: "financialCancelledBy",
  },
};

/** A DAO whose getByUuid re-read is stubbed out — this file tests the writes. */
const makeDao = (reread = { uuid: "order-uuid" }) => {
  const dao = new SalesOrderDAO();
  jest.spyOn(dao, "getByUuid").mockResolvedValue(reread);
  return dao;
};

beforeEach(() => {
  seeds = { sales_orders: { returningRows: [{ uuid: "order-uuid" }] } };
  bare = {};
  committed = undefined;
  mockKnex = jest.fn((table) => makeBuilder(table, bare));
  mockKnex.fn = { now: jest.fn(() => "NOW()") };
  mockKnex.raw = jest.fn((sql) => sql);
  mockKnex.transaction = async (cb) => {
    const pending = {};
    const trx = jest.fn((table) => makeBuilder(table, pending));
    trx.fn = { now: jest.fn(() => "NOW()") };
    // A throw propagates with `committed` left untouched: the pending captures
    // are discarded, which is this mock's rollback.
    const result = await cb(trx);
    committed = pending;
    return result;
  };
});

afterEach(() => jest.restoreAllMocks());

describe("SalesOrderDAO.setApproval pair semantics (AC-1..AC-4)", () => {
  it("commercial approve stamps the pair and nulls the cancellation", async () => {
    const dao = makeDao();

    await dao.setApproval(7, "commercial", "approve", "user@x");

    const update = committed.sales_orders.updateCaptures[0];
    expect(update.commercialApprovedAt).toBe("NOW()");
    expect(update.commercialApprovedBy).toBe("user@x");
    expect(update.commercialCancelledAt).toBeNull();
    expect(update.commercialCancelledBy).toBeNull();
  });

  it("commercial cancel stamps the cancellation and nulls the approval", async () => {
    const dao = makeDao();

    await dao.setApproval(7, "commercial", "cancel", "user@x");

    const update = committed.sales_orders.updateCaptures[0];
    expect(update.commercialCancelledAt).toBe("NOW()");
    expect(update.commercialCancelledBy).toBe("user@x");
    expect(update.commercialApprovedAt).toBeNull();
    expect(update.commercialApprovedBy).toBeNull();
  });

  it("financial approve stamps the pair and nulls the cancellation", async () => {
    const dao = makeDao();

    await dao.setApproval(7, "financial", "approve", "user@x");

    const update = committed.sales_orders.updateCaptures[0];
    expect(update.financialApprovedAt).toBe("NOW()");
    expect(update.financialApprovedBy).toBe("user@x");
    expect(update.financialCancelledAt).toBeNull();
    expect(update.financialCancelledBy).toBeNull();
  });

  it("financial cancel stamps the cancellation and nulls the approval", async () => {
    const dao = makeDao();

    await dao.setApproval(7, "financial", "cancel", "user@x");

    const update = committed.sales_orders.updateCaptures[0];
    expect(update.financialCancelledAt).toBe("NOW()");
    expect(update.financialCancelledBy).toBe("user@x");
    expect(update.financialApprovedAt).toBeNull();
    expect(update.financialApprovedBy).toBeNull();
  });

  it.each(["commercial", "financial"])(
    "never reads or writes anything beyond %s's four columns plus updatedAt (AC-4, AC-5)",
    async (machine) => {
      const cols = APPROVAL_COLUMNS[machine];
      const dao = makeDao();

      await dao.setApproval(7, machine, "approve", "user@x");

      const update = committed.sales_orders.updateCaptures[0];
      expect(Object.keys(update).sort()).toEqual(
        [
          "updatedAt",
          cols.approvedAt,
          cols.approvedBy,
          cols.cancelledAt,
          cols.cancelledBy,
        ].sort(),
      );
      // Only the id predicate — no state guard, no company clause (R-3, L-009
      // is the controller's job).
      expect(committed.sales_orders.whereCalls).toEqual([["id", 7]]);
    },
  );

  it("re-stamps an already-approved machine instead of refusing (AC-7, R-4)", async () => {
    const dao = makeDao();

    await dao.setApproval(7, "commercial", "approve", "first@x");
    await dao.setApproval(7, "commercial", "approve", "second@x");

    // No read of the current state at all: a second approve is the same write.
    const update = committed.sales_orders.updateCaptures[0];
    expect(update.commercialApprovedBy).toBe("second@x");
    expect(committed.sales_orders.firstCalls).toBeUndefined();
  });
});

describe("SalesOrderDAO.setApproval event log (AC-11)", () => {
  it.each([
    ["commercial", "approve"],
    ["commercial", "cancel"],
    ["financial", "approve"],
    ["financial", "cancel"],
  ])("inserts exactly one %s/%s event row", async (machine, action) => {
    const dao = makeDao();

    await dao.setApproval(7, machine, action, "user@x");

    const events = committed.sales_order_approval_events.insertCaptures;
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      salesOrderId: 7,
      stateMachine: machine,
      action,
      performedBy: "user@x",
    });
  });

  it("writes no event and answers null when the UPDATE matched nothing", async () => {
    // The order was deleted between the controller's uuid→id resolution and
    // this UPDATE. History for a row that no longer exists would violate the
    // events FK (23503) and the controller must be able to answer 404 rather
    // than 200 `{data: null}`.
    seeds.sales_orders = { returningRows: [] };
    const dao = makeDao();

    const result = await dao.setApproval(7, "commercial", "approve", "user@x");

    expect(result).toBeNull();
    expect(committed.sales_order_approval_events).toBeUndefined();
    expect(dao.getByUuid).not.toHaveBeenCalled();
  });
});

describe("SalesOrderDAO.setApproval atomicity (AC-12, R-7)", () => {
  it("performs both writes on the transaction handle, none on the bare knex", async () => {
    const dao = makeDao();

    await dao.setApproval(7, "commercial", "approve", "user@x");

    expect(committed.sales_orders.updateCaptures).toHaveLength(1);
    expect(committed.sales_order_approval_events.insertCaptures).toHaveLength(
      1,
    );
    expect(bare.sales_orders?.updateCaptures).toBeUndefined();
    expect(bare.sales_order_approval_events).toBeUndefined();
  });

  it("rolls the column update back when the event insert throws", async () => {
    seeds.sales_order_approval_events = {
      insertThrows: new Error("events table is unhappy"),
    };
    const dao = makeDao();

    await expect(
      dao.setApproval(7, "commercial", "approve", "user@x"),
    ).rejects.toThrow("events table is unhappy");

    // Nothing was committed: the discarded capture set IS the rollback.
    expect(committed).toBeUndefined();
    expect(bare.sales_orders?.updateCaptures).toBeUndefined();
  });
});
