// @ts-nocheck
/**
 * `autoFulfillIfComplete` — the AC-19 truth table of
 * `HandlerEventosPC.cs:35-46`, plus the two structural rules the plan pins:
 * the work runs inside a SAVEPOINT (`trx.transaction`), and a failure resolves
 * instead of rejecting (R5 — a swallowed SQL error must not leave the caller's
 * transaction in Postgres' aborted state).
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

const dao = {
  findAutoFulfillCandidate: jest.fn(),
  stampFulfillment: jest.fn(),
};

jest.mock("../../../dao/sales-order/sales-order-lifecycle.dao", () => ({
  SalesOrderLifecycleDAO: function () {
    return {
      findAutoFulfillCandidate: (...a) => dao.findAutoFulfillCandidate(...a),
      stampFulfillment: (...a) => dao.stampFulfillment(...a),
    };
  },
}));

import { autoFulfillIfComplete } from "../../../services/sales-order-fulfillment.service";

const ORDER_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/**
 * The tenant `findAutoFulfillCandidate` reads off the locked row. The stamp
 * predicates on it too (L-009), so the fixture must carry it or the tenant
 * argument is asserted as `undefined` and the predicate goes unguarded.
 */
const CANDIDATE_COMPANY_ID = 3;

/** A pedido with 2 complete OPs whose quantities exactly cover it. */
const candidate = (overrides = {}) => ({
  id: 7,
  uuid: ORDER_UUID,
  companyId: CANDIDATE_COMPANY_ID,
  quantity: 500,
  fulfilledAt: null,
  opCount: 2,
  incompleteCount: 0,
  opQuantitySum: 500,
  ...overrides,
});

/** The caller's transaction: `.transaction(cb)` is the SAVEPOINT. */
let trx;
let savepoints;

beforeEach(() => {
  jest.clearAllMocks();
  savepoints = [];
  const savepoint = { name: "savepoint" };
  trx = {
    transaction: jest.fn(async (cb) => {
      const record = { committed: false };
      savepoints.push(record);
      const result = await cb(savepoint);
      record.committed = true;
      return result;
    }),
  };
  dao.findAutoFulfillCandidate.mockResolvedValue(candidate());
  dao.stampFulfillment.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("autoFulfillIfComplete truth table (AC-19)", () => {
  it("(a) fulfills when every OP is complete and the quantities cover the pedido", async () => {
    const result = await autoFulfillIfComplete(42, "operario@acme.test", trx);

    expect(dao.stampFulfillment).toHaveBeenCalledTimes(1);
    // (id, companyId, username, trx) — the tenant travels with the candidate
    // the locked read returned, so the stamp carries a second predicate (L-009).
    expect(dao.stampFulfillment.mock.calls[0][0]).toBe(7);
    expect(dao.stampFulfillment.mock.calls[0][1]).toBe(CANDIDATE_COMPANY_ID);
    expect(dao.stampFulfillment.mock.calls[0][2]).toBe("operario@acme.test");
    expect(result).toEqual({ fulfilled: true, salesOrderUuid: ORDER_UUID });
  });

  it("(b) does not fulfill when the OP quantities do not cover the pedido", async () => {
    dao.findAutoFulfillCandidate.mockResolvedValue(
      candidate({ opQuantitySum: 499.9 }),
    );

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(dao.stampFulfillment).not.toHaveBeenCalled();
    expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
  });

  it("(b2) fulfills when the OP quantities exceed the pedido (>= , not ==)", async () => {
    dao.findAutoFulfillCandidate.mockResolvedValue(
      candidate({ opQuantitySum: 501 }),
    );

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(result.fulfilled).toBe(true);
  });

  it("(c) does not fulfill while one OP is still incomplete", async () => {
    dao.findAutoFulfillCandidate.mockResolvedValue(
      candidate({ incompleteCount: 1 }),
    );

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(dao.stampFulfillment).not.toHaveBeenCalled();
    expect(result.fulfilled).toBe(false);
  });

  it("(d) does not fulfill a pedido with no production orders", async () => {
    dao.findAutoFulfillCandidate.mockResolvedValue(
      candidate({ opCount: 0, opQuantitySum: 0 }),
    );

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(dao.stampFulfillment).not.toHaveBeenCalled();
    expect(result.fulfilled).toBe(false);
  });

  it("(e) never refreshes the stamp of an already-fulfilled pedido", async () => {
    dao.findAutoFulfillCandidate.mockResolvedValue(
      candidate({ fulfilledAt: new Date("2026-08-01T00:00:00.000Z") }),
    );

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(dao.stampFulfillment).not.toHaveBeenCalled();
    expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
  });

  it("(f) swallows a DAO failure: resolves, never rejects, and the savepoint is rolled back", async () => {
    dao.findAutoFulfillCandidate.mockRejectedValue(new Error("25P02 boom"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
    // R5: the failure happened INSIDE the savepoint, which never committed —
    // the caller's transaction stays usable.
    expect(trx.transaction).toHaveBeenCalledTimes(1);
    expect(savepoints).toHaveLength(1);
    expect(savepoints[0].committed).toBe(false);
    expect(logged).toHaveBeenCalled();
  });

  it("does nothing at all when the OP has no order_data reference", async () => {
    for (const value of [null, undefined, 0]) {
      const result = await autoFulfillIfComplete(value, "u@x", trx);
      expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
    }

    expect(trx.transaction).not.toHaveBeenCalled();
    expect(dao.findAutoFulfillCandidate).not.toHaveBeenCalled();
  });

  it("returns not-fulfilled when no pedido owns that order_data row", async () => {
    dao.findAutoFulfillCandidate.mockResolvedValue(null);

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
  });
});

describe("autoFulfillIfComplete deadlock handling", () => {
  /** A Postgres error carries its SQLSTATE on `code`. */
  const pgError = (code) => Object.assign(new Error(`pg ${code}`), { code });

  it.each(["40P01", "40001"])(
    "retries the roll-up ONCE on a %s and fulfills on the retry",
    async (code) => {
      dao.findAutoFulfillCandidate
        .mockRejectedValueOnce(pgError(code))
        .mockResolvedValueOnce(candidate());
      const logged = jest.spyOn(console, "error").mockImplementation(() => {});

      const result = await autoFulfillIfComplete(42, "u@x", trx);

      // The manual path locks sales_orders→production_orders and this one locks
      // them the other way round; Postgres kills one of the two. Swallowing
      // that would lose the roll-up PERMANENTLY — there is no reverse event and
      // every OP is now complete, so nothing would ever call this again.
      expect(result).toEqual({ fulfilled: true, salesOrderUuid: ORDER_UUID });
      expect(trx.transaction).toHaveBeenCalledTimes(2);
      expect(savepoints[0].committed).toBe(false);
      expect(savepoints[1].committed).toBe(true);
      expect(logged).not.toHaveBeenCalled();
    },
  );

  it("retries a deadlock exactly once, then reports the dropped roll-up", async () => {
    dao.findAutoFulfillCandidate.mockRejectedValue(pgError("40P01"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await autoFulfillIfComplete(42, "u@x", trx);

    expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
    expect(trx.transaction).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("orderDataId=42");
  });

  it("does not retry an ordinary failure, and names the pedido when it drops one", async () => {
    dao.findAutoFulfillCandidate.mockRejectedValue(new Error("25P02 boom"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await autoFulfillIfComplete(4242, "u@x", trx);

    expect(result).toEqual({ fulfilled: false, salesOrderUuid: null });
    expect(trx.transaction).toHaveBeenCalledTimes(1);
    // The orderDataId is the ONLY handle on a roll-up that will never fire
    // again; a log line without it is not recoverable.
    expect(String(logged.mock.calls[0][0])).toContain("orderDataId=4242");
  });
});

describe("autoFulfillIfComplete transaction discipline (R5, architecture)", () => {
  it("runs every statement on the SAVEPOINT handle the caller's trx hands out", async () => {
    await autoFulfillIfComplete(42, "u@x", trx);

    const savepointHandle = dao.findAutoFulfillCandidate.mock.calls[0][1];
    expect(savepointHandle).toEqual({ name: "savepoint" });
    expect(dao.stampFulfillment.mock.calls[0][3]).toBe(savepointHandle);
  });

  it("opens no connection of its own (no database/registry import)", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "../../../services/sales-order-fulfillment.service.ts",
      ),
      "utf8",
    );

    // The prose comment names the rule, so match the IMPORT, not the phrase.
    expect(source).not.toMatch(/from\s+"[^"]*database\/registry"/);
  });
});
