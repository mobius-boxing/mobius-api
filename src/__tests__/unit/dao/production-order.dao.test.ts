// @ts-nocheck
/**
 * ProductionOrderDAO — the two invariants a refactor is most likely to
 * "simplify" away:
 *
 *   - `setLifecycleTrx` writes EXACTLY the machine's four columns plus
 *     `updatedAt`, on the transaction handle, predicated on the id alone. That
 *     key set is what makes AC-16 ("the other two machines are untouched")
 *     provable, and it is why the six endpoints cannot interfere (AC-17).
 *   - the list query config really carries the filters and sorts the API
 *     documents (L-007): a param that is not here is accepted-and-ignored.
 *
 * The knex mock is sales-order-approval.dao.test.ts's, trimmed to what these
 * two behaviours touch.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

let captures;

const makeBuilder = (table) => {
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
    "whereIn",
    "whereNull",
    "whereNotNull",
    "orderBy",
  ].forEach(record);
  b.update = jest.fn((data) => {
    (c.updateCaptures ?? (c.updateCaptures = [])).push(data);
    return b;
  });
  b.returning = jest.fn(() => Promise.resolve([{ uuid: "op-uuid" }]));
  b.first = jest.fn(() => Promise.resolve(null));
  return b;
};

const makeTrx = () => {
  const trx = jest.fn((table) => makeBuilder(table));
  trx.fn = { now: jest.fn(() => "NOW()") };
  return trx;
};

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => makeTrx(),
}));

import {
  ProductionOrderDAO,
  LIFECYCLE_COLUMNS,
  PRODUCTION_ORDER_FILTERS,
  PRODUCTION_ORDER_SORTING,
} from "../../../dao/production-order/production-order.dao";

beforeEach(() => {
  captures = {};
});

describe("setLifecycleTrx column sets (AC-16, AC-18)", () => {
  it.each([
    ["scheduling", "schedulingApprovedAt", "schedulingCancelledAt"],
    ["completion", "completedAt", "completionCancelledAt"],
    ["void", "voidedAt", "voidCancelledAt"],
  ])("%s/set stamps the pair and clears the reversal", async (machine) => {
    const cols = LIFECYCLE_COLUMNS[machine];
    const dao = new ProductionOrderDAO();
    const trx = makeTrx();

    await dao.setLifecycleTrx(trx, 7, machine, "set", "user@x");

    const update = captures.production_orders.updateCaptures[0];
    expect(update[cols.setAt]).toBe("NOW()");
    expect(update[cols.setBy]).toBe("user@x");
    expect(update[cols.cancelledAt]).toBeNull();
    expect(update[cols.cancelledBy]).toBeNull();
  });

  it.each(["scheduling", "completion", "void"])(
    "%s/cancel stamps the reversal and clears the pair",
    async (machine) => {
      const cols = LIFECYCLE_COLUMNS[machine];
      const dao = new ProductionOrderDAO();
      const trx = makeTrx();

      await dao.setLifecycleTrx(trx, 7, machine, "cancel", "user@x");

      const update = captures.production_orders.updateCaptures[0];
      expect(update[cols.cancelledAt]).toBe("NOW()");
      expect(update[cols.cancelledBy]).toBe("user@x");
      expect(update[cols.setAt]).toBeNull();
      expect(update[cols.setBy]).toBeNull();
    },
  );

  it.each(["scheduling", "completion", "void"])(
    "%s touches nothing beyond its own four columns plus updatedAt",
    async (machine) => {
      const cols = LIFECYCLE_COLUMNS[machine];
      const dao = new ProductionOrderDAO();
      const trx = makeTrx();

      await dao.setLifecycleTrx(trx, 7, machine, "set", "user@x");

      const update = captures.production_orders.updateCaptures[0];
      expect(Object.keys(update).sort()).toEqual(
        [
          "updatedAt",
          cols.setAt,
          cols.setBy,
          cols.cancelledAt,
          cols.cancelledBy,
        ].sort(),
      );
      // Every column belonging to the OTHER two machines is absent.
      for (const other of ["scheduling", "completion", "void"]) {
        if (other === machine) continue;
        const otherCols = LIFECYCLE_COLUMNS[other];
        for (const column of Object.values(otherCols)) {
          expect(update).not.toHaveProperty(column);
        }
      }
      // Only the id predicate — the company check is the controller's (L-009).
      expect(captures.production_orders.whereCalls).toEqual([["id", 7]]);
    },
  );

  it("writes on the transaction handle it was given, never on a fresh one", async () => {
    const dao = new ProductionOrderDAO();
    const trx = makeTrx();

    await dao.setLifecycleTrx(trx, 7, "completion", "set", "user@x");

    expect(trx).toHaveBeenCalledWith("production_orders");
    expect(captures.production_orders.updateCaptures).toHaveLength(1);
  });
});

describe("LIFECYCLE_COLUMNS covers the three machines exactly once", () => {
  it("maps every machine to four distinct columns, none shared", () => {
    const all = Object.values(LIFECYCLE_COLUMNS).flatMap((cols) =>
      Object.values(cols),
    );
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });
});

describe("list query configuration (AC-23, L-007)", () => {
  it("declares every documented column filter", () => {
    expect(Object.keys(PRODUCTION_ORDER_FILTERS).sort()).toEqual(
      ["number", "uuid"].sort(),
    );
    expect(PRODUCTION_ORDER_FILTERS.number.operator).toBe("ILIKE");
  });

  // This is a uuid-only surface. `partId`/`orderDataId` are RESOLVED from
  // partUuid/orderDataUuid/salesOrderUuid and applied inside applyExtra; if
  // they were ever declared here a client could pass `?partId=5` directly and
  // enumerate sequential internal ids.
  it("never exposes a resolved internal id as a client filter", () => {
    for (const key of ["partId", "orderDataId"]) {
      expect(PRODUCTION_ORDER_FILTERS).not.toHaveProperty(key);
    }
  });

  it("declares every documented sort column", () => {
    expect(Object.keys(PRODUCTION_ORDER_SORTING).sort()).toEqual(
      ["createdAt", "deliveryDate", "number", "orderDate", "quantity"].sort(),
    );
  });
});

describe("list filter validation (AC-23, L-007)", () => {
  const list = (query) => new ProductionOrderDAO().getAllWithFilters({ query });

  it.each([
    ["schedulingState", "bogus"],
    ["completionState", "bogus"],
    ["voidState", "bogus"],
  ])(
    "rejects an out-of-set %s instead of dropping the predicate",
    async (param, value) => {
      // Dropping it answered 200 with the UNFILTERED list — the L-007 failure
      // mode: a filter the caller believes is applied and is not.
      await expect(list({ [param]: value })).rejects.toMatchObject({
        name: "ValidationError",
        message: expect.stringContaining(param),
      });
    },
  );

  it.each([
    "deliveryDateFrom",
    "deliveryDateTo",
    "orderDateFrom",
    "orderDateTo",
  ])("rejects a malformed %s before it reaches Postgres", async (param) => {
    // `new Date("notadate")` used to be handed straight to knex; Postgres
    // raised 22007 and the generic handler echoed the generated SQL back.
    await expect(list({ [param]: "notadate" })).rejects.toMatchObject({
      name: "ValidationError",
      message: expect.stringContaining(param),
    });
  });
});
