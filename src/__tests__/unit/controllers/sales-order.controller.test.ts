// @ts-nocheck
/**
 * SalesOrderController — AC-8, AC-10, AC-11, AC-12, AC-13, AC-15.
 *
 * The RBAC negative paths are covered here rather than over HTTP (plan R4):
 * the seeded dev admin is a legacy roleless admin that passes every
 * requirePermission gate through the transition fallback, so a cross-repo
 * suite cannot express "has orders.edit but not orders.edit-prices".
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const salesOrderDAO = {
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  getByUuid: jest.fn(),
  getIdByUuid: jest.fn(),
  getAllWithFilters: jest.fn(),
};
const customerDAO = { getByUuid: jest.fn() };
const productDAO = { getIdByUuid: jest.fn(), getWithDetails: jest.fn() };
const deliveryLocationDAO = { getByUuid: jest.fn() };
const userDAO = { getByUuid: jest.fn() };

let grantedCodes;

jest.mock("../../../dao/sales-order/sales-order.dao", () => ({
  SalesOrderDAO: function () {
    return {
      create: (...a) => salesOrderDAO.create(...a),
      update: (...a) => salesOrderDAO.update(...a),
      delete: (...a) => salesOrderDAO.delete(...a),
      getByUuid: (...a) => salesOrderDAO.getByUuid(...a),
      getIdByUuid: (...a) => salesOrderDAO.getIdByUuid(...a),
      getAllWithFilters: (...a) => salesOrderDAO.getAllWithFilters(...a),
    };
  },
}));
jest.mock("../../../dao/customer/customer.dao", () => ({
  CustomerDAO: function () {
    return { getByUuid: (...a) => customerDAO.getByUuid(...a) };
  },
}));
jest.mock("../../../dao/product/product.dao", () => ({
  ProductDAO: function () {
    return {
      getIdByUuid: (...a) => productDAO.getIdByUuid(...a),
      getWithDetails: (...a) => productDAO.getWithDetails(...a),
    };
  },
}));
jest.mock("../../../dao/delivery-location/delivery-location.dao", () => ({
  DeliveryLocationDAO: function () {
    return { getByUuid: (...a) => deliveryLocationDAO.getByUuid(...a) };
  },
}));
jest.mock("../../../dao/user/user.dao", () => ({
  UserDAO: function () {
    return { getByUuid: (...a) => userDAO.getByUuid(...a) };
  },
}));
jest.mock("../../../services/rbac.service", () => ({
  RbacService: {
    userHasPermission: (_uuid, _role, code) =>
      Promise.resolve(grantedCodes.includes(code)),
  },
}));
jest.mock("../../../services/audit.service", () => ({
  AuditService: function () {
    return { record: () => Promise.resolve(undefined) };
  },
}));

import { SalesOrderController } from "../../../controllers/sales-order/sales-order.controller";

const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRODUCT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORDER_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => ((res.statusCode = code), res));
  res.json = (payload) => ((res.body = payload), res);
  return res;
};

const makeReq = (body = {}, overrides = {}) => ({
  params: { uuid: ORDER_UUID },
  body,
  query: {},
  user: {
    userId: "u-1",
    email: "vendedor@acme.test",
    role: "member",
    companyId: "company-a-uuid",
  },
  ...overrides,
});

const validCreateBody = (extra = {}) => ({
  customerUuid: CUSTOMER_A,
  productUuid: PRODUCT_A,
  quantity: 100,
  ...extra,
});

const storedOrder = (overrides = {}) => ({
  id: 7,
  uuid: ORDER_UUID,
  companyId: 1,
  number: "00000001",
  quantity: 100,
  deliveryDate: "2026-09-01T00:00:00.000Z",
  customer: { uuid: CUSTOMER_A, name: "Acme" },
  product: { uuid: PRODUCT_A, code: "P1" },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  grantedCodes = [
    "orders.edit",
    "orders.delete",
    "orders.edit-prices",
    "orders.edit-delivery-date",
    "orders.view-sales-sector",
  ];
  customerDAO.getByUuid.mockResolvedValue({
    id: 3,
    uuid: CUSTOMER_A,
    companyId: 1,
    salesPersonId: 22,
  });
  productDAO.getIdByUuid.mockResolvedValue(4);
  productDAO.getWithDetails.mockResolvedValue({
    uuid: PRODUCT_A,
    code: "P1",
    customer: { uuid: CUSTOMER_A, name: "Acme" },
  });
  salesOrderDAO.create.mockResolvedValue({
    uuid: ORDER_UUID,
    number: "00000001",
  });
  salesOrderDAO.update.mockResolvedValue({ uuid: ORDER_UUID, quantity: 250 });
  salesOrderDAO.delete.mockResolvedValue(true);
  salesOrderDAO.getIdByUuid.mockResolvedValue(7);
  salesOrderDAO.getByUuid.mockResolvedValue(storedOrder());
});

// ── AC-8: the product/customer pairing is enforced server-side ─────────────
describe("create: product/customer pairing (AC-8)", () => {
  it("400s a product belonging to another customer and never touches the DAO", async () => {
    productDAO.getWithDetails.mockResolvedValue({
      uuid: PRODUCT_B,
      customer: { uuid: CUSTOMER_B, name: "Otra" },
    });
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ productUuid: PRODUCT_B })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/does not belong/);
    expect(salesOrderDAO.create).not.toHaveBeenCalled();
  });

  it("creates when the product belongs to the chosen customer", async () => {
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody()),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(201);
    expect(salesOrderDAO.create).toHaveBeenCalledTimes(1);
    expect(salesOrderDAO.create.mock.calls[0][0]).toMatchObject({
      companyId: 1,
      customerId: 3,
      productId: 4,
      quantity: 100,
      createdByUsername: "vendedor@acme.test",
    });
  });

  it("defaults the vendedor from the customer's salesPerson (D-7)", async () => {
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody()),
      res,
      jest.fn(),
    );

    expect(salesOrderDAO.create.mock.calls[0][0].salesUserId).toBe(22);
  });

  it("routes the observaciones to order_data, not to the order row", async () => {
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(
        validCreateBody({
          notes: "obs",
          dispatchNotes: "desp",
          conversionNotes: "conv",
        }),
      ),
      res,
      jest.fn(),
    );

    const payload = salesOrderDAO.create.mock.calls[0][0];
    expect(payload.orderDataInput).toMatchObject({
      notes: "obs",
      dispatchNotes: "desp",
      conversionNotes: "conv",
    });
    expect(payload).not.toHaveProperty("notes");
  });
});

// ── AC-10: orders.edit-prices ──────────────────────────────────────────────
describe("price/paid gate (AC-10)", () => {
  beforeEach(() => {
    grantedCodes = ["orders.edit", "orders.view-sales-sector"];
  });

  it.each(["price", "paid"])("403s a body containing %s", async (key) => {
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ [key]: 10 })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/orders.edit-prices/);
    expect(salesOrderDAO.create).not.toHaveBeenCalled();
  });

  it("accepts the identical body with those keys removed", async () => {
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody()),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(201);
    expect(salesOrderDAO.create).toHaveBeenCalledTimes(1);
  });

  it("403s a PUT containing price too", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ price: 5 }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(403);
    expect(salesOrderDAO.update).not.toHaveBeenCalled();
  });
});

// ── AC-11: orders.view-sales-sector ────────────────────────────────────────
describe("salesSector gate and projection (AC-11)", () => {
  it("403s writing salesSector without the permission", async () => {
    grantedCodes = ["orders.edit"];
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ salesSector: "NORTE" })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/orders.view-sales-sector/);
    expect(salesOrderDAO.create).not.toHaveBeenCalled();
  });

  it("omits the salesSector key from a GET for a caller without the code", async () => {
    grantedCodes = ["orders.edit"];
    salesOrderDAO.getByUuid.mockResolvedValue(
      storedOrder({ salesSector: "NORTE" }),
    );
    const res = makeRes();

    await new SalesOrderController().getByUuid(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toHaveProperty("salesSector");
    expect(res.body.data.number).toBe("00000001");
  });

  it("keeps salesSector for a caller who holds the code", async () => {
    salesOrderDAO.getByUuid.mockResolvedValue(
      storedOrder({ salesSector: "NORTE" }),
    );
    const res = makeRes();

    await new SalesOrderController().getByUuid(makeReq(), res, jest.fn());

    expect(res.body.data.salesSector).toBe("NORTE");
  });

  it("omits salesSector from every row of a list response", async () => {
    grantedCodes = ["orders.edit"];
    salesOrderDAO.getAllWithFilters.mockResolvedValue({
      success: true,
      data: [storedOrder({ salesSector: "NORTE" })],
      page: 1,
      limit: 20,
      count: 1,
      totalCount: 1,
      totalPages: 1,
    });
    const res = makeRes();

    await new SalesOrderController().getAll(makeReq(), res, jest.fn());

    expect(res.body.data[0]).not.toHaveProperty("salesSector");
  });
});

// ── AC-12: orders.edit-delivery-date ───────────────────────────────────────
describe("deliveryDate gate (AC-12)", () => {
  beforeEach(() => {
    grantedCodes = ["orders.edit", "orders.view-sales-sector"];
  });

  it("403s a PUT that changes deliveryDate", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ deliveryDate: "2026-12-31T00:00:00.000Z" }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/orders.edit-delivery-date/);
    expect(salesOrderDAO.update).not.toHaveBeenCalled();
  });

  it("200s a PUT re-sending the stored deliveryDate", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ deliveryDate: "2026-09-01T00:00:00.000Z" }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(salesOrderDAO.update).toHaveBeenCalledTimes(1);
  });
});

// ── AC-13: immutable references ────────────────────────────────────────────
describe("update immutability (AC-13)", () => {
  it("400s a different customerUuid", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ customerUuid: CUSTOMER_B }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Customer cannot be changed/);
    expect(salesOrderDAO.update).not.toHaveBeenCalled();
  });

  it("400s a different productUuid", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ productUuid: PRODUCT_B }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Product cannot be changed/);
  });

  it("200s when the same customerUuid and productUuid are re-sent", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({
        customerUuid: CUSTOMER_A,
        productUuid: PRODUCT_A,
        quantity: 250,
      }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(salesOrderDAO.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ quantity: 250 }),
    );
  });

  it("never sends the immutable uuids on to the DAO payload", async () => {
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ customerUuid: CUSTOMER_A, productUuid: PRODUCT_A }),
      res,
      jest.fn(),
    );

    const payload = salesOrderDAO.update.mock.calls[0][1];
    expect(payload).not.toHaveProperty("customerUuid");
    expect(payload).not.toHaveProperty("productUuid");
  });
});

// ── AC-15: tenant scoping ──────────────────────────────────────────────────
describe("tenant scoping (AC-15, L-009)", () => {
  it("404s a GET for an order owned by another company", async () => {
    salesOrderDAO.getByUuid.mockResolvedValue(null);
    const res = makeRes();

    await new SalesOrderController().getByUuid(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(404);
  });

  it("404s a PUT for an order owned by another company", async () => {
    salesOrderDAO.getIdByUuid.mockResolvedValue(null);
    const res = makeRes();

    await new SalesOrderController().update(
      makeReq({ quantity: 5 }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(404);
    expect(salesOrderDAO.update).not.toHaveBeenCalled();
  });

  it("404s a DELETE for an order owned by another company", async () => {
    salesOrderDAO.getIdByUuid.mockResolvedValue(null);
    const res = makeRes();

    await new SalesOrderController().delete(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(salesOrderDAO.delete).not.toHaveBeenCalled();
  });

  it("404s a POST naming another company's customer", async () => {
    customerDAO.getByUuid.mockResolvedValue(null);
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ customerUuid: CUSTOMER_B })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Customer not found");
    expect(salesOrderDAO.create).not.toHaveBeenCalled();
  });

  it("resolves lookups with the caller's company uuid, not a body value", async () => {
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody()),
      res,
      jest.fn(),
    );

    expect(customerDAO.getByUuid).toHaveBeenCalledWith(
      CUSTOMER_A,
      "company-a-uuid",
    );
    expect(productDAO.getIdByUuid).toHaveBeenCalledWith(
      PRODUCT_A,
      "company-a-uuid",
    );
  });

  it("scopes the list by the caller's company", async () => {
    salesOrderDAO.getAllWithFilters.mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      limit: 20,
      count: 0,
      totalCount: 0,
      totalPages: 0,
    });
    const res = makeRes();

    await new SalesOrderController().getAll(makeReq(), res, jest.fn());

    expect(salesOrderDAO.getAllWithFilters).toHaveBeenCalledWith(
      expect.anything(),
      "company-a-uuid",
    );
  });
});

// ── Delivery location / vendedor references ────────────────────────────────
describe("reference validation", () => {
  it("400s a delivery location belonging to another customer", async () => {
    deliveryLocationDAO.getByUuid.mockResolvedValue({
      id: 12,
      uuid: "loc-uuid",
      customer: { uuid: CUSTOMER_B },
    });
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ deliveryLocationUuid: "loc-uuid" })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Delivery location does not belong/);
    expect(salesOrderDAO.create).not.toHaveBeenCalled();
  });

  it("passes a matching delivery location through to order_data", async () => {
    deliveryLocationDAO.getByUuid.mockResolvedValue({
      id: 12,
      uuid: "loc-uuid",
      customer: { uuid: CUSTOMER_A },
    });
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ deliveryLocationUuid: "loc-uuid" })),
      res,
      jest.fn(),
    );

    expect(salesOrderDAO.create.mock.calls[0][0].orderDataInput).toMatchObject({
      deliveryLocationId: 12,
    });
  });

  it("400s a vendedor from another company (L-009)", async () => {
    userDAO.getByUuid.mockResolvedValue({ id: 9, companyId: 99 });
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ salesUserUuid: "user-uuid" })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Sales user not found");
    expect(salesOrderDAO.create).not.toHaveBeenCalled();
  });

  it("accepts a vendedor from the same company", async () => {
    userDAO.getByUuid.mockResolvedValue({ id: 9, companyId: 1 });
    const res = makeRes();

    await new SalesOrderController().create(
      makeReq(validCreateBody({ salesUserUuid: "user-uuid" })),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(201);
    expect(salesOrderDAO.create.mock.calls[0][0].salesUserId).toBe(9);
  });
});
