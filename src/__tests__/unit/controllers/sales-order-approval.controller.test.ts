// @ts-nocheck
/**
 * SalesOrderController.setApproval — AC-8..AC-11.
 *
 * Nothing here asserts on the audit trail any more: since P2 the ledger row
 * is written by the `sales_orders` trigger, so the controller has no audit
 * path left to mock.
 *
 * The two invariants worth a mutation check live here (AC-20): the uuid→id
 * resolution is company-scoped (L-009 — dropping the argument must redden
 * "resolves uuid→id inside the caller's company scope"), and the DAO — the only
 * writer of `sales_order_approval_events` — is never reached on a 400 or a 404,
 * which is the "no event row on failure" half that no HTTP suite can see.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const salesOrderDAO = {
  getIdByUuid: jest.fn(),
  setApproval: jest.fn(),
};
const userHasPermission = jest.fn(() => Promise.resolve(true));

jest.mock("../../../dao/sales-order/sales-order.dao", () => ({
  SalesOrderDAO: function () {
    return {
      getIdByUuid: (...a) => salesOrderDAO.getIdByUuid(...a),
      setApproval: (...a) => salesOrderDAO.setApproval(...a),
    };
  },
}));
jest.mock("../../../services/rbac.service", () => ({
  RbacService: {
    userHasPermission: (...a) => userHasPermission(...a),
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

const makeReq = (overrides = {}) => ({
  params: { uuid: ORDER_UUID, machine: "commercial" },
  body: { action: "approve" },
  query: {},
  user: {
    userId: "u-1",
    email: "gerente@acme.test",
    role: "member",
    companyId: COMPANY_A,
  },
  ...overrides,
});

const updatedOrder = {
  uuid: ORDER_UUID,
  commercialApprovedAt: "2026-08-21T10:00:00.000Z",
  commercialApprovedBy: "gerente@acme.test",
};

let controller;

beforeEach(() => {
  jest.clearAllMocks();
  userHasPermission.mockResolvedValue(true);
  salesOrderDAO.getIdByUuid.mockResolvedValue(7);
  salesOrderDAO.setApproval.mockResolvedValue(updatedOrder);
  controller = new SalesOrderController();
});

describe("SalesOrderController.setApproval input guards (AC-10)", () => {
  it("rejects an unknown machine without calling the DAO", async () => {
    const req = makeReq({
      params: { uuid: ORDER_UUID, machine: "fulfillment" },
      body: { action: "approve" },
    });
    const res = makeRes();

    await controller.setApproval(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/commercial, financial/);
    expect(salesOrderDAO.getIdByUuid).not.toHaveBeenCalled();
    expect(salesOrderDAO.setApproval).not.toHaveBeenCalled();
  });

  it("rejects an unknown action without calling the DAO", async () => {
    const req = makeReq({ body: { action: "nope" } });
    const res = makeRes();

    await controller.setApproval(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("action must be approve or cancel");
    expect(salesOrderDAO.setApproval).not.toHaveBeenCalled();
  });

  it("rejects a missing action body without calling the DAO", async () => {
    const req = makeReq({ body: {} });
    const res = makeRes();

    await controller.setApproval(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(salesOrderDAO.setApproval).not.toHaveBeenCalled();
  });

  it("rejects a BODYLESS request with the same 400, never a 500", async () => {
    // Express 5 leaves `req.body` undefined when no body is sent at all —
    // `const { action } = req.body` throws a TypeError there, and the error
    // middleware answers 500 with its text. `body: {}` cannot catch this.
    const req = makeReq({ body: undefined });
    const res = makeRes();
    const next = jest.fn();

    await controller.setApproval(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("action must be approve or cancel");
    expect(salesOrderDAO.setApproval).not.toHaveBeenCalled();
  });

  it("validates the input BEFORE spending an RBAC round trip", async () => {
    // applySalesSectorProjection asks rbac.service, which queries the database.
    // A malformed request must be rejected without paying for that.
    const req = makeReq({ body: { action: "nope" } });

    await controller.setApproval(req, makeRes(), jest.fn());

    expect(userHasPermission).not.toHaveBeenCalled();
  });
});

describe("SalesOrderController.setApproval tenancy (AC-9, L-009)", () => {
  it("resolves uuid→id inside the caller's company scope", async () => {
    const req = makeReq();
    const res = makeRes();

    await controller.setApproval(req, res, jest.fn());

    expect(salesOrderDAO.getIdByUuid).toHaveBeenCalledWith(
      ORDER_UUID,
      COMPANY_A,
    );
  });

  it("lets a superAdmin without ?companyId= see every company", async () => {
    const req = makeReq({
      user: {
        userId: "u-0",
        email: "root@mobius.test",
        role: "superAdmin",
        companyId: COMPANY_A,
      },
    });

    await controller.setApproval(req, makeRes(), jest.fn());

    expect(salesOrderDAO.getIdByUuid).toHaveBeenCalledWith(
      ORDER_UUID,
      undefined,
    );
  });

  it("404s and never writes when the uuid resolves to nothing in scope", async () => {
    salesOrderDAO.getIdByUuid.mockResolvedValue(null);
    const res = makeRes();

    await controller.setApproval(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Sales order not found");
    expect(salesOrderDAO.setApproval).not.toHaveBeenCalled();
  });
});

describe("SalesOrderController.setApproval success path (AC-1, AC-11)", () => {
  it("stamps through the DAO with the caller's email and returns the DTO", async () => {
    const res = makeRes();

    await controller.setApproval(makeReq(), res, jest.fn());

    expect(salesOrderDAO.setApproval).toHaveBeenCalledWith(
      7,
      "commercial",
      "approve",
      "gerente@acme.test",
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: updatedOrder });
  });

  it("falls back to 'unknown' when the token carries no email (R-6)", async () => {
    const req = makeReq({
      user: { userId: "u-1", role: "member", companyId: COMPANY_A },
    });

    await controller.setApproval(req, makeRes(), jest.fn());

    expect(salesOrderDAO.setApproval).toHaveBeenCalledWith(
      7,
      "commercial",
      "approve",
      "unknown",
    );
  });

  it("404s when the row vanished mid-request", async () => {
    // The DAO answers null when its UPDATE matched nothing (the order was
    // deleted between the uuid→id resolution and the write). A 200 with
    // `data: null` would claim a modification the database never made — and
    // since P2 the ledger row is written by the trigger, so nothing was
    // recorded either.
    salesOrderDAO.setApproval.mockResolvedValue(null);
    const res = makeRes();

    await controller.setApproval(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Sales order not found",
    });
  });

  it("drives the financial machine with the financial columns", async () => {
    const req = makeReq({
      params: { uuid: ORDER_UUID, machine: "financial" },
      body: { action: "cancel" },
    });

    await controller.setApproval(req, makeRes(), jest.fn());

    expect(salesOrderDAO.setApproval).toHaveBeenCalledWith(
      7,
      "financial",
      "cancel",
      "gerente@acme.test",
    );
  });

  it("forwards a DAO failure to the error middleware, never a 200", async () => {
    salesOrderDAO.setApproval.mockRejectedValue(new Error("boom"));
    const next = jest.fn();
    const res = makeRes();

    await controller.setApproval(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });
});
