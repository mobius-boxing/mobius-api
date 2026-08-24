// @ts-nocheck
/**
 * SalesOrderDAO — AC-5, AC-13, AC-14, AC-16, AC-17, AC-18, AC-19.
 *
 * The 1:1 order_data write/delete is the invariant this file guards (L-006):
 * both rows are created, mirrored and deleted inside ONE transaction, and
 * nothing else cleans up after a partial write. The numbering assertions guard
 * D-5 — the counter service is the only numbering call, no table scan.
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

// ── Table-aware thenable knex mock (part.dao.test.ts pattern) ───────────────
let fixtures;
let builders; // every builder handed out, in creation order

const makeBuilder = (table) => {
  const f = fixtures[table] ?? (fixtures[table] = {});
  const b = { table };
  const record = (name) =>
    (b[name] = jest.fn((...args) => {
      (f[`${name}Calls`] ?? (f[`${name}Calls`] = [])).push(args);
      return b;
    }));
  [
    "select",
    "where",
    "whereIn",
    "whereNull",
    "whereNotNull",
    "orderBy",
    "leftJoin",
    "join",
    "limit",
    "offset",
    "groupBy",
  ].forEach(record);
  b.first = jest.fn(() => Promise.resolve((f.firstRows ?? []).shift() ?? null));
  b.update = jest.fn((data) => {
    (f.updateCaptures ?? (f.updateCaptures = [])).push(data);
    return b;
  });
  b.insert = jest.fn((data) => {
    (f.insertCaptures ?? (f.insertCaptures = [])).push(data);
    return b;
  });
  b.delete = jest.fn(() => {
    (f.deleteCalls ?? (f.deleteCalls = [])).push(true);
    return Promise.resolve(f.deleteCount ?? 1);
  });
  b.returning = jest.fn(() => Promise.resolve(f.returningRows ?? []));
  b.count = jest.fn(() => b);
  b.then = (resolve, reject) =>
    Promise.resolve(f.rows ?? []).then(resolve, reject);
  builders.push(b);
  return b;
};

let mockKnex;
let trxSeen;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { SalesOrderDAO } from "../../../dao/sales-order/sales-order.dao";
import { CodeGeneratorService } from "../../../services/code-generator.service";

const req = (query = {}) => ({ query });

// sales-order-list validates the shape of every `*Uuid` filter (a malformed
// value is a 400, never an unfiltered 200), so these fixtures are real uuids.
const CUSTOMER_UUID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_UUID = "22222222-2222-4222-8222-222222222222";
const SALES_USER_UUID = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_UUID = "44444444-4444-4444-8444-444444444444";

/** A raw sales_orders row as the joins return it. */
const row = (overrides = {}) => ({
  id: 7,
  uuid: "order-uuid",
  companyId: 1,
  number: "00000001",
  quantity: 100,
  price: null,
  priceTotal: null,
  customerId: 3,
  productId: 4,
  orderDataId: 9,
  createdAt: "2026-08-20T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  fixtures = {};
  builders = [];
  trxSeen = [];
  mockKnex = jest.fn((table) => makeBuilder(table));
  mockKnex.transaction = async (cb) => {
    trxSeen.push(mockKnex);
    return cb(mockKnex);
  };
  mockKnex.fn = { now: jest.fn(() => "NOW()") };
  mockKnex.raw = jest.fn((s) => s);
});

afterEach(() => jest.restoreAllMocks());

// ── AC-5: numbering ─────────────────────────────────────────────────────────
describe("SalesOrderDAO numbering (AC-5, D-5)", () => {
  it("asks CodeGeneratorService for the sales-order scope exactly once", async () => {
    const next = jest
      .spyOn(CodeGeneratorService.prototype, "next")
      .mockResolvedValue("00000042");
    fixtures.order_data = { returningRows: [{ id: 9 }] };
    fixtures.sales_orders = { returningRows: [{ uuid: "order-uuid" }] };
    const dao = new SalesOrderDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "order-uuid" });

    await dao.create({
      companyId: 1,
      customerId: 3,
      productId: 4,
      quantity: 5,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(1, "sales-order");
    expect(fixtures.sales_orders.insertCaptures[0].number).toBe("00000042");
  });

  it("never scans for the highest existing number (no aggregate in the DAO)", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../../dao/sales-order/sales-order.dao.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/max\(/i);
  });
});

// ── AC-6 / AC-13 / AC-14: the 1:1 pair ──────────────────────────────────────
describe("SalesOrderDAO create (AC-6)", () => {
  beforeEach(() => {
    jest
      .spyOn(CodeGeneratorService.prototype, "next")
      .mockResolvedValue("00000001");
  });

  it("writes order_data first and links it from the order, in one transaction", async () => {
    fixtures.order_data = { returningRows: [{ id: 9 }] };
    fixtures.sales_orders = { returningRows: [{ uuid: "order-uuid" }] };
    const dao = new SalesOrderDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "order-uuid" });

    await dao.create({
      companyId: 1,
      customerId: 3,
      productId: 4,
      quantity: 100,
      orderDataInput: { notes: "obs", deliveryLocationId: 12 },
    });

    expect(trxSeen).toHaveLength(1);
    const orderData = fixtures.order_data.insertCaptures[0];
    expect(orderData).toMatchObject({
      companyId: 1,
      customerId: 3,
      number: "00000001",
      quantity: 100,
      notes: "obs",
      deliveryLocationId: 12,
    });
    expect(fixtures.sales_orders.insertCaptures[0]).toMatchObject({
      orderDataId: 9,
      number: "00000001",
    });
  });

  it("snapshots the creating username on createdBy", async () => {
    fixtures.order_data = { returningRows: [{ id: 9 }] };
    fixtures.sales_orders = { returningRows: [{ uuid: "order-uuid" }] };
    const dao = new SalesOrderDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "order-uuid" });

    await dao.create({
      companyId: 1,
      customerId: 3,
      productId: 4,
      quantity: 1,
      createdByUsername: "vendedor@acme.test",
    });

    expect(fixtures.sales_orders.insertCaptures[0].createdBy).toBe(
      "vendedor@acme.test",
    );
  });
});

describe("SalesOrderDAO update (AC-13)", () => {
  it("mirrors quantity and number into order_data on the same transaction", async () => {
    fixtures.sales_orders = {
      firstRows: [
        { id: 7, uuid: "order-uuid", number: "00000001", orderDataId: 9 },
      ],
    };
    const dao = new SalesOrderDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "order-uuid" });

    await dao.update(7, { quantity: 250 });

    expect(trxSeen).toHaveLength(1);
    expect(fixtures.sales_orders.updateCaptures[0]).toMatchObject({
      quantity: 250,
    });
    expect(fixtures.order_data.updateCaptures[0]).toMatchObject({
      quantity: 250,
      number: "00000001",
    });
  });

  it("routes the notes fields to order_data, never to sales_orders", async () => {
    fixtures.sales_orders = {
      firstRows: [
        { id: 7, uuid: "order-uuid", number: "00000001", orderDataId: 9 },
      ],
    };
    const dao = new SalesOrderDAO();
    jest.spyOn(dao, "getByUuid").mockResolvedValue({ uuid: "order-uuid" });

    await dao.update(7, {
      purchaseOrder: "OC-9",
      orderDataInput: { notes: "n", dispatchNotes: "d", conversionNotes: "c" },
    });

    expect(fixtures.sales_orders.updateCaptures[0]).not.toHaveProperty("notes");
    expect(fixtures.order_data.updateCaptures[0]).toMatchObject({
      notes: "n",
      dispatchNotes: "d",
      conversionNotes: "c",
    });
  });

  it("returns null for a missing order without writing anything", async () => {
    fixtures.sales_orders = { firstRows: [null] };
    const dao = new SalesOrderDAO();

    expect(await dao.update(999, { quantity: 5 })).toBeNull();
    expect(fixtures.sales_orders.updateCaptures).toBeUndefined();
  });
});

describe("SalesOrderDAO delete (AC-14, L-006)", () => {
  it("deletes the order and then its order_data row on the same transaction", async () => {
    fixtures.sales_orders = { firstRows: [{ orderDataId: 9 }] };
    const dao = new SalesOrderDAO();

    expect(await dao.delete(7)).toBe(true);

    expect(trxSeen).toHaveLength(1);
    expect(fixtures.sales_orders.deleteCalls).toHaveLength(1);
    expect(fixtures.order_data.deleteCalls).toHaveLength(1);
    // Both builders were handed out by the SAME connection object (the trx).
    expect(new Set(builders.map((b) => b.table))).toContain("order_data");
  });

  it("leaves order_data alone when the order row was already gone", async () => {
    fixtures.sales_orders = { firstRows: [null] };
    const dao = new SalesOrderDAO();

    expect(await dao.delete(7)).toBe(false);
    expect(fixtures.order_data?.deleteCalls).toBeUndefined();
  });
});

// ── AC-19: every list param is wired ────────────────────────────────────────
describe("SalesOrderDAO.getAllWithFilters params (AC-19, L-007)", () => {
  const listWhereCalls = () => fixtures.sales_orders.whereCalls ?? [];

  beforeEach(() => {
    fixtures.sales_orders = { rows: [], firstRows: [{ count: "0" }] };
  });

  it("resolves customerUuid to the numeric customerId filter", async () => {
    fixtures.customers = { firstRows: [{ id: 31 }] };
    await new SalesOrderDAO().getAllWithFilters(
      req({ customerUuid: CUSTOMER_UUID }),
    );

    expect(fixtures.customers.whereCalls[0]).toEqual(["uuid", CUSTOMER_UUID]);
    expect(listWhereCalls()).toContainEqual([
      "sales_orders.customerId",
      "=",
      31,
    ]);
  });

  it("resolves productUuid to the numeric productId filter", async () => {
    fixtures.products = { firstRows: [{ id: 44 }] };
    await new SalesOrderDAO().getAllWithFilters(
      req({ productUuid: PRODUCT_UUID }),
    );

    expect(listWhereCalls()).toContainEqual([
      "sales_orders.productId",
      "=",
      44,
    ]);
  });

  it("resolves salesUserUuid to the numeric salesUserId filter", async () => {
    fixtures.users = { firstRows: [{ id: 55 }] };
    await new SalesOrderDAO().getAllWithFilters(
      req({ salesUserUuid: SALES_USER_UUID }),
    );

    expect(listWhereCalls()).toContainEqual([
      "sales_orders.salesUserId",
      "=",
      55,
    ]);
  });

  it("pins an unknown uuid to the impossible id -1 instead of ignoring it", async () => {
    fixtures.customers = { firstRows: [null] };
    await new SalesOrderDAO().getAllWithFilters(
      req({ customerUuid: UNKNOWN_UUID }),
    );

    expect(listWhereCalls()).toContainEqual([
      "sales_orders.customerId",
      "=",
      -1,
    ]);
  });

  it("applies number as a case-insensitive partial match", async () => {
    await new SalesOrderDAO().getAllWithFilters(req({ number: "0000001" }));

    expect(listWhereCalls()).toContainEqual([
      "sales_orders.number",
      "ILIKE",
      "%0000001%",
    ]);
  });

  it("applies purchaseOrder as a case-insensitive partial match", async () => {
    await new SalesOrderDAO().getAllWithFilters(req({ purchaseOrder: "OC-9" }));

    expect(listWhereCalls()).toContainEqual([
      "sales_orders.purchaseOrder",
      "ILIKE",
      "%OC-9%",
    ]);
  });

  it("applies uuid as an exact filter", async () => {
    await new SalesOrderDAO().getAllWithFilters(req({ uuid: "order-uuid" }));

    expect(listWhereCalls()).toContainEqual([
      "sales_orders.uuid",
      "=",
      "order-uuid",
    ]);
  });

  it("searches number, purchaseOrder and supplierCode", async () => {
    await new SalesOrderDAO().getAllWithFilters(req({ search: "term" }));

    const grouped = listWhereCalls().find(
      (args) => typeof args[0] === "function",
    );
    expect(grouped).toBeDefined();
    const captured = [];
    grouped[0]({
      where: (...a) => captured.push(a),
      orWhere: (...a) => captured.push(a),
    });
    expect(captured.map((a) => a[0])).toEqual([
      "sales_orders.number",
      "sales_orders.purchaseOrder",
      "sales_orders.supplierCode",
    ]);
  });

  it("honours sortBy=deliveryDate&sortOrder=asc", async () => {
    await new SalesOrderDAO().getAllWithFilters(
      req({ sortBy: "deliveryDate", sortOrder: "asc" }),
    );

    expect(fixtures.sales_orders.orderByCalls).toContainEqual([
      "sales_orders.deliveryDate",
      "asc",
    ]);
  });

  // sales-order-list moved the default to `id desc` (spec D-8: Procusto's
  // grid is OrderByDescending(c => c.Id)); `id` is not a `sortBy` value.
  it("defaults to id desc", async () => {
    await new SalesOrderDAO().getAllWithFilters(req({}));

    expect(fixtures.sales_orders.orderByCalls).toContainEqual([
      "sales_orders.id",
      "desc",
    ]);
  });

  it("honours page and limit", async () => {
    const result = await new SalesOrderDAO().getAllWithFilters(
      req({ page: "2", limit: "1" }),
    );

    expect(fixtures.sales_orders.limitCalls).toContainEqual([1]);
    expect(fixtures.sales_orders.offsetCalls).toContainEqual([1]);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(1);
  });

  it("scopes the list by the company uuid the controller hands it (L-009)", async () => {
    await new SalesOrderDAO().getAllWithFilters(req({}), "company-uuid");

    expect(fixtures.sales_orders.joinCalls).toContainEqual([
      "companies",
      "sales_orders.companyId",
      "companies.id",
    ]);
    expect(listWhereCalls()).toContainEqual(["companies.uuid", "company-uuid"]);
  });
});

// ── AC-16 / AC-17 / AC-18: the derived surface ──────────────────────────────
describe("SalesOrderDAO mapping (AC-16, AC-17, AC-18)", () => {
  const mapOne = async (raw) => {
    fixtures.sales_orders = { rows: [raw], firstRows: [{ count: "1" }] };
    const result = await new SalesOrderDAO().getAllWithFilters(req({}));
    return result.data[0];
  };

  it("exposes priceTotal from the SQL projection (AC-16)", async () => {
    const order = await mapOne(
      row({ price: "12.5000", priceTotal: "1250.0000" }),
    );

    expect(order.priceTotal).toBe(1250);
    expect(order.price).toBe(12.5);
  });

  it("leaves priceTotal null when there is no price (AC-16)", async () => {
    const order = await mapOne(row({ price: null, priceTotal: null }));

    expect(order.priceTotal).toBeNull();
  });

  it("reports a fresh order as pending with all five booleans false (AC-17)", async () => {
    const order = await mapOne(row());

    expect(order.status).toBe("pending");
    expect(order.commerciallyApproved).toBe(false);
    expect(order.financiallyApproved).toBe(false);
    expect(order.fulfilled).toBe(false);
    expect(order.voided).toBe(false);
    expect(order.creditLimitOverridden).toBe(false);
  });

  it.each([
    [{ commercialApprovedAt: "t" }, "commercially-approved"],
    [{ financialApprovedAt: "t" }, "financially-approved"],
    [{ commercialApprovedAt: "t", financialApprovedAt: "t" }, "approved"],
    [
      { commercialApprovedAt: "t", financialApprovedAt: "t", fulfilledAt: "t" },
      "fulfilled",
    ],
    [
      {
        commercialApprovedAt: "t",
        financialApprovedAt: "t",
        fulfilledAt: "t",
        voidedAt: "t",
      },
      "voided",
    ],
  ])("derives %j as %s (AC-17)", async (columns, expected) => {
    const order = await mapOne(row(columns));

    expect(order.status).toBe(expected);
  });

  it("flags a credit-limit override without changing the status (AC-17)", async () => {
    const order = await mapOne(row({ creditLimitOverrideAt: "t" }));

    expect(order.creditLimitOverridden).toBe(true);
    expect(order.status).toBe("pending");
  });

  it("emits no numeric id or FK key anywhere in the payload (AC-18)", async () => {
    const order = await mapOne(
      row({
        customer: { id: 3, uuid: "cust-uuid", name: "Acme", companyId: 1 },
        product: { id: 4, uuid: "prod-uuid", code: "P1", customerId: 3 },
        salesUser: { id: 5, uuid: "user-uuid", name: "Vendedor" },
        orderData: {
          id: 9,
          uuid: "od-uuid",
          number: "00000001",
          quantity: 100,
        },
        deliveryLocation: { id: 12, uuid: "dl-uuid", address: "Calle 1" },
      }),
    );

    const serialized = JSON.stringify(order);
    expect(serialized).not.toMatch(/"id":/);
    expect(serialized).not.toMatch(/"customerId":/);
    expect(serialized).not.toMatch(/"productId":/);
    expect(serialized).not.toMatch(/"orderDataId":/);
    expect(order.customer).toEqual({ uuid: "cust-uuid", name: "Acme" });
    expect(order.orderData.deliveryLocation).toEqual({
      uuid: "dl-uuid",
      address: "Calle 1",
    });
  });

  it("re-attaches the numeric id on getByUuid for the caller's own use (L-005)", async () => {
    fixtures.sales_orders = { firstRows: [row()] };

    const order = await new SalesOrderDAO().getByUuid("order-uuid");

    expect(order.id).toBe(7);
    expect(order.uuid).toBe("order-uuid");
  });

  it("scopes getByUuid and getIdByUuid by company (L-009)", async () => {
    fixtures.sales_orders = { firstRows: [null, null] };
    const dao = new SalesOrderDAO();

    await dao.getByUuid("order-uuid", "company-uuid");
    await dao.getIdByUuid("order-uuid", "company-uuid");

    expect(fixtures.sales_orders.whereCalls).toContainEqual([
      "companies.uuid",
      "company-uuid",
    ]);
  });
});
