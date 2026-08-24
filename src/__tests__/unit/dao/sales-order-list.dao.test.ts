// @ts-nocheck
/**
 * SalesOrderDAO — the pedido LIST surface (sales-order-list AC-1..AC-5, AC-15,
 * AC-16, AC-18, AC-21, AC-34) plus the associated-orders read.
 *
 * The invariant this file exists for is AC-18: every derived predicate lives in
 * ONE `applyExtra` closure that is applied to the data query AND the count
 * query. A predicate that reaches only the data builder makes `totalCount` lie
 * under pagination, and nothing else in the stack would notice.
 *
 * The knex mock is table-AND-key aware (part.dao.test.ts pattern, copied
 * locally on purpose): every builder remembers which connection key created it,
 * which is what lets the `users` lookup prove it does not run on `erp`.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

let fixtures; // per-table canned results
let builders; // every builder handed out, in creation order

/** Every recorded call as `name(args…)`, with objects/functions flattened. */
const signature = (call) =>
  `${call[0]}(${call[1]
    .map((arg) =>
      typeof arg === "function"
        ? "<fn>"
        : arg && typeof arg === "object"
          ? "<builder>"
          : String(arg),
    )
    .join(",")})`;

const makeBuilder = (key, table) => {
  const f = fixtures[table] ?? (fixtures[table] = {});
  const b = { table, dbKey: key, calls: [] };
  const record = (name) =>
    (b[name] = jest.fn((...args) => {
      (f[`${name}Calls`] ?? (f[`${name}Calls`] = [])).push(args);
      b.calls.push([name, args]);
      return b;
    }));
  [
    "select",
    "where",
    "whereRaw",
    "whereIn",
    "whereNull",
    "whereNotNull",
    "whereExists",
    "whereNotExists",
    "orWhere",
    "orderBy",
    "leftJoin",
    "join",
    "limit",
    "offset",
  ].forEach(record);
  b.first = jest.fn(() => Promise.resolve((f.firstRows ?? []).shift() ?? null));
  b.count = jest.fn(() => b);
  b.then = (resolve, reject) =>
    Promise.resolve(f.rows ?? []).then(resolve, reject);
  builders.push(b);
  return b;
};

const makeKnex = (key) => {
  const knex = jest.fn((table) => makeBuilder(key, table));
  knex.raw = jest.fn((sql) => sql);
  knex.fn = { now: jest.fn(() => "NOW()") };
  return knex;
};

let knexByKey;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key) => knexByKey[key],
}));

import {
  SalesOrderDAO,
  SALES_ORDER_FILTERS,
  SALES_ORDER_SORTING,
  SALES_ORDER_QUERY_CONFIG,
} from "../../../dao/sales-order/sales-order.dao";
// The three validators moved to the shared util the DAO now imports; they are
// exercised here through the same list surface that consumes them.
import {
  parseTriStateParam,
  parseDateParam,
  assertUuidParam,
} from "../../../utils/query-params";

const req = (query = {}) => ({ query });

const CUSTOMER_UUID = "11111111-1111-4111-8111-111111111111";
const PART_UUID = "22222222-2222-4222-8222-222222222222";
const SHEET_UUID = "33333333-3333-4333-8333-333333333333";
const SALES_USER_UUID = "44444444-4444-4444-8444-444444444444";
const ORDER_UUID = "55555555-5555-4555-8555-555555555555";

const list = (query = {}, companyUuid) =>
  new SalesOrderDAO().getAllWithFilters(req(query), companyUuid);

/** The two `sales_orders` builders: [data query, count query]. */
const orderBuilders = () => builders.filter((b) => b.table === "sales_orders");

/** Only the predicates `applyExtra` adds — joins, null checks, EXISTS forms. */
const DERIVED_METHODS = new Set([
  "join",
  "where",
  "whereNull",
  "whereNotNull",
  "whereExists",
  "whereNotExists",
]);
const derivedSignature = (builder) =>
  builder.calls.filter((call) => DERIVED_METHODS.has(call[0])).map(signature);

const DAO_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../dao/sales-order/sales-order.dao.ts"),
  "utf8",
);

beforeEach(() => {
  fixtures = {};
  builders = [];
  knexByKey = { erp: makeKnex("erp"), core: makeKnex("core") };
  fixtures.sales_orders = { rows: [], firstRows: [{ count: "0" }] };
});

afterEach(() => jest.restoreAllMocks());

// ── AC-1: query-builder wiring ─────────────────────────────────────────────
describe("query-builder wiring (AC-1)", () => {
  it("declares the three configs outside the DAO class, as module exports", () => {
    expect(typeof SALES_ORDER_FILTERS).toBe("object");
    expect(typeof SALES_ORDER_SORTING).toBe("object");
    expect(SALES_ORDER_QUERY_CONFIG.tableName).toBe("sales_orders");
    // "outside the class" is a source fact, not a runtime one.
    const classAt = DAO_SOURCE.indexOf("export class SalesOrderDAO");
    for (const name of [
      "export const SALES_ORDER_FILTERS",
      "export const SALES_ORDER_SORTING",
      "export const SALES_ORDER_QUERY_CONFIG",
    ]) {
      expect(DAO_SOURCE.indexOf(name)).toBeGreaterThan(-1);
      expect(DAO_SOURCE.indexOf(name)).toBeLessThan(classAt);
    }
  });

  it("wires every documented filter param to a sales_orders column", () => {
    // The five numeric ids are deliberately absent: they are resolved from
    // their `*Uuid` params and applied as predicates, never accepted as query
    // params on a uuid-only API.
    expect(Object.keys(SALES_ORDER_FILTERS).sort()).toEqual(
      [
        "deliveryDateFrom",
        "deliveryDateTo",
        "number",
        "purchaseOrder",
        "uuid",
      ].sort(),
    );
    expect(SALES_ORDER_FILTERS.number.operator).toBe("ILIKE");
    expect(SALES_ORDER_FILTERS.deliveryDateFrom).toMatchObject({
      column: "deliveryDate",
      operator: ">=",
    });
    expect(SALES_ORDER_FILTERS.deliveryDateTo).toMatchObject({
      column: "deliveryDate",
      operator: "<=",
    });
  });

  it("offers only own-table sort columns and defaults to id desc (D-8)", () => {
    expect(Object.keys(SALES_ORDER_SORTING).sort()).toEqual([
      "createdAt",
      "deliveryDate",
      "number",
      "price",
      "purchaseOrder",
      "quantity",
      "supplierCode",
      "updatedAt",
    ]);
    expect(SALES_ORDER_QUERY_CONFIG.defaultSort).toEqual({
      column: "id",
      order: "desc",
    });
    expect(SALES_ORDER_SORTING.id).toBeUndefined();
  });

  it("returns the IDataPaginator shape the builder computes", async () => {
    fixtures.sales_orders = {
      rows: [{ uuid: ORDER_UUID }],
      firstRows: [{ count: "7" }],
    };
    const result = await list({ page: "2", limit: "3" });

    expect(result).toMatchObject({
      success: true,
      page: 2,
      limit: 3,
      count: 1,
      totalCount: 7,
      totalPages: 3,
    });
    expect(fixtures.sales_orders.offsetCalls).toContainEqual([3]);
  });

  it("hand-rolls no pagination arithmetic and uses no bracket filter syntax", () => {
    expect(DAO_SOURCE).not.toContain("filter[");
    const start = DAO_SOURCE.indexOf("async getAllWithFilters");
    const body = DAO_SOURCE.slice(
      start,
      DAO_SOURCE.indexOf("private takeTriState", start),
    );
    expect(body).not.toContain(".offset(");
    expect(body).not.toContain("page - 1");
  });
});

// ── AC-2: the limit clamp ──────────────────────────────────────────────────
describe("pagination clamp (AC-2, F-2)", () => {
  it("clamps limit=500 to 100 in the query builder", async () => {
    // The route's validatePagination answers 400 long before this runs; the
    // clamp is the second belt, and it is what this asserts.
    const result = await list({ limit: "500" });

    expect(result.limit).toBe(100);
    expect(fixtures.sales_orders.limitCalls).toContainEqual([100]);
  });
});

// ── AC-5 / AC-6..AC-9: column and uuid filters ─────────────────────────────
describe("column filters (AC-5, AC-7..AC-9, AC-13)", () => {
  const orderWheres = () => fixtures.sales_orders.whereCalls ?? [];

  it("matches number as a case-insensitive substring", async () => {
    await list({ number: "2026-00" });

    expect(orderWheres()).toContainEqual([
      "sales_orders.number",
      "ILIKE",
      "%2026-00%",
    ]);
  });

  it("resolves partUuid against parts", async () => {
    fixtures.parts = { firstRows: [{ id: 12 }] };
    await list({ partUuid: PART_UUID });

    expect(fixtures.parts.whereCalls[0]).toEqual(["uuid", PART_UUID]);
    expect(orderWheres()).toContainEqual(["sales_orders.partId", "=", 12]);
  });

  it("resolves sheetSupplyUuid against paper_sheets (F-1)", async () => {
    fixtures.paper_sheets = { firstRows: [{ id: 5 }] };
    await list({ sheetSupplyUuid: SHEET_UUID });

    expect(fixtures.paper_sheets.whereCalls[0]).toEqual(["uuid", SHEET_UUID]);
    expect(orderWheres()).toContainEqual([
      "sales_orders.sheetSupplyId",
      "=",
      5,
    ]);
  });

  it("applies both delivery-date bounds inclusively", async () => {
    await list({
      deliveryDateFrom: "2026-01-01",
      deliveryDateTo: "2026-01-31",
    });

    // Recorded once per builder — the data query and the count query.
    for (const builder of orderBuilders()) {
      const operators = builder.calls
        .filter((call) => call[1][0] === "sales_orders.deliveryDate")
        .map((call) => call[1][1]);
      expect(operators).toEqual([">=", "<="]);
    }
  });

  it("stretches a date-only deliveryDateTo to the end of that day", async () => {
    // Every fixture in the suites is midnight UTC, which hides this: with a
    // bare `<= 2026-01-31T00:00Z` a pedido delivered at 15:00 on the 31st is
    // NOT returned by `deliveryDateTo=2026-01-31`, which reads as data loss.
    await list({ deliveryDateTo: "2026-01-31" });

    const bound = fixtures.sales_orders.whereCalls.find(
      (call) => call[0] === "sales_orders.deliveryDate",
    )[2];
    expect(bound.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("honours a time-bearing deliveryDateTo exactly as given", async () => {
    await list({ deliveryDateTo: "2026-01-31T09:30:00.000Z" });

    const bound = fixtures.sales_orders.whereCalls.find(
      (call) => call[0] === "sales_orders.deliveryDate",
    )[2];
    expect(bound.toISOString()).toBe("2026-01-31T09:30:00.000Z");
  });

  it("reads users on the CORE connection, never on erp", async () => {
    // Regression guard: `users` is core-owned, so an erp-side lookup trips the
    // registry's wrong-database guard and 500s the whole list request outside
    // production (it only logs in production, which is worse).
    fixtures.users = { firstRows: [{ id: 55 }] };
    await list({ salesUserUuid: SALES_USER_UUID });

    const userBuilders = builders.filter((b) => b.table === "users");
    expect(userBuilders).toHaveLength(1);
    expect(userBuilders[0].dbKey).toBe("core");
    expect(orderBuilders()[0].dbKey).toBe("erp");
    expect(fixtures.sales_orders.whereCalls).toContainEqual([
      "sales_orders.salesUserId",
      "=",
      55,
    ]);
  });

  it("pins an unknown uuid to the impossible id -1", async () => {
    fixtures.customers = { firstRows: [null] };
    await list({ customerUuid: CUSTOMER_UUID });

    expect(orderWheres()).toContainEqual(["sales_orders.customerId", "=", -1]);
  });

  it.each([
    ["customerId", "1"],
    ["productId", "1"],
    ["partId", "1"],
    ["sheetSupplyId", "1"],
    ["salesUserId", "1"],
  ])(
    "ignores the internal numeric filter ?%s=%s (uuid-only surface)",
    async (param, value) => {
      await list({ [param]: value });

      // Unknown filter keys are silently dropped by the query builder; what
      // must never happen is the DAO honouring an internal id as a filter.
      for (const builder of orderBuilders()) {
        const predicates = builder.calls
          .filter((call) => call[0] === "where")
          .map((call) => String(call[1][0]));
        expect(predicates).not.toContain(`sales_orders.${param}`);
        expect(predicates).not.toContain(param);
      }
    },
  );

  it("applies a resolved uuid filter to the COUNT query too (AC-18)", async () => {
    fixtures.customers = { firstRows: [{ id: 9 }] };
    await list({ customerUuid: CUSTOMER_UUID });

    // A predicate that reaches only the data builder makes totalCount lie
    // under pagination — the exact failure `applyExtra` exists to prevent.
    for (const builder of orderBuilders()) {
      expect(
        builder.calls
          .filter((call) => call[0] === "where")
          .map((call) => call[1]),
      ).toContainEqual(["sales_orders.customerId", "=", 9]);
    }
    expect(orderBuilders()).toHaveLength(2);
  });
});

// ── AC-21: the validators ──────────────────────────────────────────────────
describe("param validation (AC-21, L-007)", () => {
  it.each(["yes", "1", "maybe", "on", "TRUE"])(
    "rejects %s as a tri-state value with a ValidationError",
    (raw) => {
      expect(() => parseTriStateParam("fulfilled", raw)).toThrow(
        'Invalid value for fulfilled: expected "true" or "false"',
      );
      try {
        parseTriStateParam("fulfilled", raw);
      } catch (err) {
        expect(err.name).toBe("ValidationError");
      }
    },
  );

  it("accepts exactly true/false and treats absence as no predicate", () => {
    expect(parseTriStateParam("voided", "true")).toBe(true);
    expect(parseTriStateParam("voided", "false")).toBe(false);
    expect(parseTriStateParam("voided", undefined)).toBeUndefined();
  });

  it("rejects an unparseable date and accepts an ISO one", () => {
    expect(() => parseDateParam("deliveryDateFrom", "not-a-date")).toThrow(
      /Invalid value for deliveryDateFrom/,
    );
    expect(parseDateParam("deliveryDateFrom", "2026-01-01")).toBeInstanceOf(
      Date,
    );
  });

  it("rejects a malformed uuid and accepts a well-formed one", () => {
    expect(() => assertUuidParam("customerUuid", "not-a-uuid")).toThrow(
      /Invalid value for customerUuid/,
    );
    expect(assertUuidParam("customerUuid", CUSTOMER_UUID)).toBe(CUSTOMER_UUID);
  });

  it.each([
    ["fulfilled", "yes"],
    ["voided", "1"],
    ["onlyApproved", "maybe"],
    ["withoutProductionOrders", "on"],
    ["allProductionOrdersFulfilled", "sure"],
  ])(
    "makes the list throw for %s=%s instead of answering unfiltered",
    async (param, value) => {
      await expect(list({ [param]: value })).rejects.toMatchObject({
        name: "ValidationError",
      });
    },
  );

  it("makes the list throw for a malformed customerUuid", async () => {
    await expect(list({ customerUuid: "nope" })).rejects.toMatchObject({
      name: "ValidationError",
    });
  });
});

// ── AC-10..AC-12, AC-14..AC-16: the derived predicates ─────────────────────
describe("derived predicates (AC-10..AC-12, AC-14..AC-16)", () => {
  it("switches on fulfilled/voided rather than widening the set", async () => {
    await list({ fulfilled: "true", voided: "false" });

    expect(fixtures.sales_orders.whereNotNullCalls).toContainEqual([
      "sales_orders.fulfilledAt",
    ]);
    expect(fixtures.sales_orders.whereNullCalls).toContainEqual([
      "sales_orders.voidedAt",
    ]);
  });

  it("emits no lifecycle predicate at all when the flags are omitted", async () => {
    await list({});

    expect(fixtures.sales_orders.whereNotNullCalls).toBeUndefined();
    expect(fixtures.sales_orders.whereNullCalls).toBeUndefined();
  });

  it("requires BOTH approvals for onlyApproved=true and none for false", async () => {
    await list({ onlyApproved: "true" });
    expect(fixtures.sales_orders.whereNotNullCalls).toEqual([
      ["sales_orders.commercialApprovedAt"],
      ["sales_orders.financialApprovedAt"],
      ["sales_orders.commercialApprovedAt"],
      ["sales_orders.financialApprovedAt"],
    ]);

    fixtures = {};
    builders = [];
    fixtures.sales_orders = { rows: [], firstRows: [{ count: "0" }] };
    await list({ onlyApproved: "false" });
    expect(fixtures.sales_orders.whereNotNullCalls).toBeUndefined();
  });

  it("expresses withoutProductionOrders as one NOT EXISTS on orderDataId", async () => {
    await list({ withoutProductionOrders: "true" });

    const data = orderBuilders()[0];
    expect(data.calls.filter((c) => c[0] === "whereNotExists")).toHaveLength(1);
    expect(fixtures.production_orders.whereRawCalls[0][0]).toBe(
      '"production_orders"."orderDataId" = "sales_orders"."orderDataId"',
    );
  });

  it("never reads voidedAt for allProductionOrdersFulfilled (AC-15c)", async () => {
    await list({ allProductionOrdersFulfilled: "true" });

    const subs = builders.filter((b) => b.table === "production_orders");
    const emitted = subs.flatMap((b) => b.calls.map(signature)).join(" ");
    expect(emitted).toContain("whereNull(production_orders.completedAt)");
    expect(emitted).not.toContain("voidedAt");
    // EXISTS ≥1 order AND NOT EXISTS an uncompleted one.
    const data = orderBuilders()[0];
    expect(data.calls.filter((c) => c[0] === "whereExists")).toHaveLength(1);
    expect(data.calls.filter((c) => c[0] === "whereNotExists")).toHaveLength(1);
  });

  it("groups the two order filters into ONE OR when both are true (AC-16)", async () => {
    await list({
      withoutProductionOrders: "true",
      allProductionOrdersFulfilled: "true",
    });

    const data = orderBuilders()[0];
    // No AND-chained EXISTS on the outer builder: exactly one grouped where().
    expect(data.calls.filter((c) => c[0] === "whereNotExists")).toHaveLength(0);
    expect(data.calls.filter((c) => c[0] === "whereExists")).toHaveLength(0);
    const grouped = data.calls.filter(
      (c) => c[0] === "where" && typeof c[1][0] === "function",
    );
    expect(grouped).toHaveLength(1);

    // Replay the callback: NOT EXISTS … OR ( EXISTS … AND NOT EXISTS … ).
    const probe = makeBuilder("erp", "probe");
    grouped[0][1][0](probe);
    expect(probe.calls.map((c) => c[0])).toEqual(["whereNotExists", "orWhere"]);
    const inner = makeBuilder("erp", "probe-inner");
    probe.calls[1][1][0](inner);
    expect(inner.calls.map((c) => c[0])).toEqual([
      "whereExists",
      "whereNotExists",
    ]);
  });
});

// ── AC-18: the count query sees exactly what the data query sees ───────────
describe("applyExtra symmetry (AC-18)", () => {
  it.each([
    ["fulfilled=false&voided=false", { fulfilled: "false", voided: "false" }],
    ["onlyApproved=true", { onlyApproved: "true" }],
    ["withoutProductionOrders=true", { withoutProductionOrders: "true" }],
    [
      "allProductionOrdersFulfilled=true",
      { allProductionOrdersFulfilled: "true" },
    ],
    [
      "both order filters",
      {
        withoutProductionOrders: "true",
        allProductionOrdersFulfilled: "true",
      },
    ],
  ])(
    "records the same derived predicates on both builders for %s",
    async (_label, query) => {
      await list(query, "company-uuid");

      const [data, count] = orderBuilders();
      expect(count).toBeDefined();
      expect(derivedSignature(count)).toEqual(derivedSignature(data));
      // …and the company scope is part of what both receive (L-009).
      expect(derivedSignature(data)[0]).toBe(
        "join(companies,sales_orders.companyId,companies.id)",
      );
    },
  );
});

// ── AC-34: the item description ────────────────────────────────────────────
describe("item description (AC-34)", () => {
  const mapOne = async (raw) => {
    fixtures.sales_orders = {
      rows: [{ uuid: ORDER_UUID, ...raw }],
      firstRows: [{ count: "1" }],
    };
    const result = await list({});
    return result.data[0].itemDescription;
  };

  it("builds the producto form", async () => {
    expect(
      await mapOne({
        product: { uuid: "p", code: "C1", description: "Caja", revision: 3 },
      }),
    ).toBe("Producto: C1 - Caja - Revisión: 3");
  });

  it("builds the parte form", async () => {
    expect(
      await mapOne({
        part: { uuid: "p", code: "PT1", description: "Tapa", revision: 0 },
      }),
    ).toBe("Parte: PT1 - Tapa - Revisión: 0");
  });

  it("builds the plancha form, without a revision", async () => {
    expect(
      await mapOne({
        sheetSupply: { uuid: "s", code: "PL1", description: "Plancha B" },
      }),
    ).toBe("Plancha: PL1 - Plancha B");
  });

  it("is the empty string when none of the three is set", async () => {
    expect(await mapOne({})).toBe("");
  });
});

// ── The associated-orders read ─────────────────────────────────────────────
describe("getAssociatedProductionOrders (AC-25, AC-26)", () => {
  const dao = () => new SalesOrderDAO();

  it("returns null when the pedido is out of the caller's company scope", async () => {
    fixtures.sales_orders = { firstRows: [null] };

    expect(
      await dao().getAssociatedProductionOrders(ORDER_UUID, "company-b", 1, 20),
    ).toBeNull();
    expect(fixtures.sales_orders.joinCalls).toContainEqual([
      "companies",
      "sales_orders.companyId",
      "companies.id",
    ]);
  });

  it("answers an empty page for orderDataId = NULL, never an error", async () => {
    fixtures.sales_orders = { firstRows: [{ orderDataId: null }] };

    const result = await dao().getAssociatedProductionOrders(
      ORDER_UUID,
      undefined,
      1,
      20,
    );
    expect(result).toMatchObject({ data: [], totalCount: 0, totalPages: 0 });
    expect(builders.some((b) => b.table === "production_orders")).toBe(false);
  });

  it("selects the ten uuid-only fields, number ascending", async () => {
    fixtures.sales_orders = { firstRows: [{ orderDataId: 9 }] };
    fixtures.production_orders = {
      rows: [
        {
          uuid: "op-uuid",
          number: "00000001",
          orderDate: "2026-01-01",
          deliveryDate: "2026-02-01",
          quantity: "500",
          schedulingApprovedAt: "2026-01-02",
          completedAt: null,
          voidedAt: null,
          partUuid: "part-uuid",
          partCode: "PT1",
          partDescription: "Tapa",
          customerUuid: "cust-uuid",
          customerName: "Acme",
        },
      ],
      firstRows: [{ count: "1" }],
    };

    const result = await dao().getAssociatedProductionOrders(
      ORDER_UUID,
      undefined,
      1,
      20,
    );

    expect(fixtures.production_orders.orderByCalls).toContainEqual([
      "production_orders.number",
      "asc",
    ]);
    expect(result.data[0]).toEqual({
      uuid: "op-uuid",
      number: "00000001",
      orderDate: "2026-01-01",
      deliveryDate: "2026-02-01",
      quantity: 500,
      part: { uuid: "part-uuid", code: "PT1", description: "Tapa" },
      customer: { uuid: "cust-uuid", name: "Acme" },
      schedulingApprovedAt: "2026-01-02",
      completedAt: null,
      voidedAt: null,
    });
    expect(JSON.stringify(result.data)).not.toMatch(/"id":|"partId":/);
  });
});
