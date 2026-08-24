// @ts-nocheck
/**
 * SalesOrderController.setFulfillment / .setVoid — the branches no HTTP suite
 * can see: the 400s that never reach the DAO, the 409, the "no audit row on a
 * no-op" rule (AC-3, AC-4, AC-20) and the L-007 cascade-unavailable rejection
 * (AC-18).
 *
 * Two invariants here are mutation-checked (AC-13, AC-22): the uuid→id
 * resolution is company-scoped (dropping the argument must redden
 * "resolves uuid→id inside the caller's company scope"), and a `rejected`
 * outcome must answer 409 with nothing written.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import path from "path";

const salesOrderDAO = {
  getIdByUuid: jest.fn(),
};
const lifecycleDAO = {
  setFulfillment: jest.fn(),
  setVoid: jest.fn(),
  cascadeAvailable: jest.fn(),
};
const auditRecord = jest.fn();

jest.mock("../../../dao/sales-order/sales-order.dao", () => ({
  SalesOrderDAO: function () {
    return {
      getIdByUuid: (...a) => salesOrderDAO.getIdByUuid(...a),
    };
  },
}));
jest.mock("../../../dao/sales-order/sales-order-lifecycle.dao", () => ({
  SalesOrderLifecycleDAO: function () {
    return {
      setFulfillment: (...a) => lifecycleDAO.setFulfillment(...a),
      setVoid: (...a) => lifecycleDAO.setVoid(...a),
      cascadeAvailable: (...a) => lifecycleDAO.cascadeAvailable(...a),
    };
  },
}));
jest.mock("../../../services/rbac.service", () => ({
  RbacService: {
    userHasPermission: () => Promise.resolve(true),
  },
}));
jest.mock("../../../services/audit.service", () => ({
  AuditService: function () {
    return {
      record: (...a) => (auditRecord(...a), Promise.resolve(undefined)),
    };
  },
}));

import { SalesOrderController } from "../../../controllers/sales-order/sales-order.controller";

const ORDER_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMPANY_A = "11111111-1111-4111-8111-111111111111";

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => ((res.statusCode = code), res));
  res.json = jest.fn((payload) => ((res.body = payload), res));
  return res;
};

const makeReq = (body, overrides = {}) => ({
  params: { uuid: ORDER_UUID },
  body,
  query: {},
  user: {
    userId: "u-1",
    email: "gerente@acme.test",
    role: "member",
    companyId: COMPANY_A,
  },
  ...overrides,
});

const order = { uuid: ORDER_UUID, fulfilledAt: "2026-08-21T10:00:00.000Z" };
const changed = (affected = 0) => ({
  changed: true,
  productionOrdersAffected: affected,
  order,
});
const noop = { changed: false, productionOrdersAffected: 0, order };

let controller;

beforeEach(() => {
  jest.clearAllMocks();
  salesOrderDAO.getIdByUuid.mockResolvedValue(7);
  lifecycleDAO.setFulfillment.mockResolvedValue(changed());
  lifecycleDAO.setVoid.mockResolvedValue(changed());
  lifecycleDAO.cascadeAvailable.mockResolvedValue(true);
  controller = new SalesOrderController();
});

describe("input guards (AC-9)", () => {
  it.each([
    ["fulfillment", { action: "approve" }],
    ["fulfillment", {}],
    ["fulfillment", { action: null }],
  ])("400s %s for %p without reaching the DAO", async (_endpoint, body) => {
    const res = makeRes();

    await controller.setFulfillment(makeReq(body), res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("action must be fulfill or cancel");
    expect(salesOrderDAO.getIdByUuid).not.toHaveBeenCalled();
    expect(lifecycleDAO.setFulfillment).not.toHaveBeenCalled();
  });

  it.each([[{ action: "approve" }], [{}], [{ action: null }]])(
    "400s void for %p without reaching the DAO",
    async (body) => {
      const res = makeRes();

      await controller.setVoid(makeReq(body), res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe("action must be void or cancel");
      expect(salesOrderDAO.getIdByUuid).not.toHaveBeenCalled();
      expect(lifecycleDAO.setVoid).not.toHaveBeenCalled();
    },
  );

  it("400s a non-boolean includeProductionOrders", async () => {
    const res = makeRes();

    await controller.setVoid(
      makeReq({ action: "void", includeProductionOrders: "yes" }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/includeProductionOrders/);
    expect(lifecycleDAO.setVoid).not.toHaveBeenCalled();
  });
});

describe("includeProductionOrders is never accepted-and-ignored (AC-18, L-007)", () => {
  it.each([[true], [false]])(
    "400s includeProductionOrders:%p when the pedido→OP link is unavailable",
    async (value) => {
      lifecycleDAO.cascadeAvailable.mockResolvedValue(false);
      const res = makeRes();

      await controller.setVoid(
        makeReq({ action: "void", includeProductionOrders: value }),
        res,
        jest.fn(),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/includeProductionOrders/);
      expect(lifecycleDAO.setVoid).not.toHaveBeenCalled();
    },
  );

  it("does not probe the schema when the flag is absent", async () => {
    await controller.setVoid(makeReq({ action: "void" }), makeRes(), jest.fn());

    expect(lifecycleDAO.cascadeAvailable).not.toHaveBeenCalled();
    expect(lifecycleDAO.setVoid).toHaveBeenCalledWith(
      7,
      "void",
      "gerente@acme.test",
      false,
    );
  });
});

describe("tenancy (AC-11, AC-13, L-005, L-009)", () => {
  it("resolves uuid→id inside the caller's company scope", async () => {
    await controller.setFulfillment(
      makeReq({ action: "fulfill" }),
      makeRes(),
      jest.fn(),
    );

    expect(salesOrderDAO.getIdByUuid).toHaveBeenCalledWith(
      ORDER_UUID,
      COMPANY_A,
    );
  });

  it("lets a superAdmin without ?companyId= see every company", async () => {
    const req = makeReq(
      { action: "void" },
      {
        user: {
          userId: "u-0",
          email: "root@mobius.test",
          role: "superAdmin",
          companyId: COMPANY_A,
        },
      },
    );

    await controller.setVoid(req, makeRes(), jest.fn());

    expect(salesOrderDAO.getIdByUuid).toHaveBeenCalledWith(
      ORDER_UUID,
      undefined,
    );
  });

  it.each([
    ["setFulfillment", { action: "fulfill" }],
    ["setVoid", { action: "void" }],
  ])(
    "404s %s and never writes for an out-of-scope uuid",
    async (verb, body) => {
      salesOrderDAO.getIdByUuid.mockResolvedValue(null);
      const res = makeRes();

      await controller[verb](makeReq(body), res, jest.fn());

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toBe("Sales order not found");
      expect(lifecycleDAO.setFulfillment).not.toHaveBeenCalled();
      expect(lifecycleDAO.setVoid).not.toHaveBeenCalled();
    },
  );

  it("never guards on a mapped entity's .id (L-005 source scan)", () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "../../../controllers/sales-order/sales-order.controller.ts",
      ),
      "utf8",
    );
    const methods = source.slice(source.indexOf("public async setFulfillment"));

    expect(methods).toContain("getIdByUuid(");
    expect(methods).not.toMatch(/if \(!\w+\.id\)/);
    expect(methods).not.toMatch(/if \(!\w+\?\.id\)/);
  });
});

describe("success, no-op and rejection responses (AC-1, AC-3, AC-4, AC-6, AC-20)", () => {
  it("returns the DTO plus productionOrdersAffected as a sibling of data (P-2)", async () => {
    lifecycleDAO.setFulfillment.mockResolvedValue(changed(2));
    const res = makeRes();

    await controller.setFulfillment(
      makeReq({ action: "fulfill" }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: order,
      productionOrdersAffected: 2,
    });
  });

  it("records exactly one Modificacion audit row for a state change", async () => {
    await controller.setFulfillment(
      makeReq({ action: "fulfill" }),
      makeRes(),
      jest.fn(),
    );

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord.mock.calls[0][1]).toBe("Sales order");
    expect(auditRecord.mock.calls[0][2]).toBe("Modificacion");
    expect(auditRecord.mock.calls[0][3]).toBe(order);
  });

  it.each([
    ["setFulfillment", { action: "fulfill" }],
    ["setVoid", { action: "void" }],
  ])("records NO audit row when %s is a no-op", async (verb, body) => {
    lifecycleDAO.setFulfillment.mockResolvedValue(noop);
    lifecycleDAO.setVoid.mockResolvedValue(noop);
    const res = makeRes();

    await controller[verb](makeReq(body), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("answers 409 with a non-empty message and no audit row on a rejection", async () => {
    lifecycleDAO.setVoid.mockResolvedValue({
      changed: false,
      rejected: "ORDER_ALREADY_FULFILLED",
      productionOrdersAffected: 0,
      order,
    });
    const res = makeRes();

    await controller.setVoid(makeReq({ action: "void" }), res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("passes the caller's email, falling back to 'unknown' (D-3)", async () => {
    const req = makeReq(
      { action: "cancel" },
      { user: { userId: "u-1", role: "member", companyId: COMPANY_A } },
    );

    await controller.setFulfillment(req, makeRes(), jest.fn());

    expect(lifecycleDAO.setFulfillment).toHaveBeenCalledWith(
      7,
      "cancel",
      "unknown",
    );
  });

  it("forwards a DAO failure to the error middleware, never a 200 (AC-21)", async () => {
    lifecycleDAO.setFulfillment.mockRejectedValue(new Error("boom"));
    const next = jest.fn();
    const res = makeRes();

    await controller.setFulfillment(makeReq({ action: "fulfill" }), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });
});
