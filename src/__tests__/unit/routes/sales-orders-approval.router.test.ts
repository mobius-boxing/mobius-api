// @ts-nocheck
/**
 * The approval route's gate — AC-8 and AC-10.
 *
 * Two things are proven here that no other layer can prove:
 *   1. `orderApprovalPermissionCode` is the single mapping machine→code, and it
 *      is total (anything else is `null`, never a fallback code);
 *   2. an unknown `:machine` is answered 400 BEFORE `requirePermission` is even
 *      constructed — the deliberate divergence from parts.router.ts:90-92,
 *      whose fallback to `parts.approve.part` would turn AC-10's 400 into a 403
 *      (or a 200 for a privileged caller).
 *
 * The middlewares are faked so the chain can be exercised without a database:
 * the real ones are covered by their own suites and by the HTTP suite in
 * repos/tests.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

/** Codes the fake requirePermission accepts, per test. */
let grantedCodes = [];

// jest.config resets mock implementations between tests, so both fakes are
// (re)installed in beforeEach — see below.
const requirePermissionFactory = jest.fn();
const setApprovalHandler = jest.fn();

const fakeRequirePermission = (code) => (_req, res, next) => {
  if (grantedCodes.includes(code)) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    message: `Insufficient permissions. Required: ${code}`,
  });
};

const fakeSetApproval = (req, res) => {
  res.status(200).json({ success: true, data: { uuid: req.params.uuid } });
};

jest.mock("../../../middlewares", () => ({
  authenticate: (req, res, next) => {
    if (!req.headers.authorization) {
      res.status(401).json({ success: false, message: "No token provided" });
      return;
    }
    req.user = {
      userId: "u-1",
      email: "gerente@acme.test",
      role: "member",
      companyId: "11111111-1111-4111-8111-111111111111",
    };
    next();
  },
  requireAdmin: () => (_req, _res, next) => next(),
  requirePermission: (...args) => requirePermissionFactory(...args),
  validateUUID: () => (_req, _res, next) => next(),
  validatePagination: (_req, _res, next) => next(),
  apiRateLimiter: (_req, _res, next) => next(),
  sensitiveRateLimiter: (_req, _res, next) => next(),
}));

jest.mock("../../../controllers/sales-order/sales-order.controller", () => ({
  SalesOrderController: function () {
    return {
      getAll: (_req, res) => res.status(200).json({ success: true }),
      getByUuid: (_req, res) => res.status(200).json({ success: true }),
      create: (_req, res) => res.status(201).json({ success: true }),
      update: (_req, res) => res.status(200).json({ success: true }),
      delete: (_req, res) => res.status(200).json({ success: true }),
      setApproval: (...a) => setApprovalHandler(...a),
      // Added by sales-order-fulfillment: the router binds these two, so the
      // stand-in class must own them or `initRoutes` throws before any
      // assertion below runs. No approval assertion depends on them.
      setFulfillment: (_req, res) => res.status(200).json({ success: true }),
      setVoid: (_req, res) => res.status(200).json({ success: true }),
      // Added by sales-order-list, for the same reason.
      getProductionOrders: (_req, res) =>
        res.status(200).json({ success: true }),
    };
  },
}));

import { SalesOrdersRouter } from "../../../routes/sales-orders/sales-orders.router";
import {
  ORDER_APPROVAL_MACHINES,
  orderApprovalPermissionCode,
} from "../../../interfaces/sales-order/sales-order-approval.interfaces";

const ORDER_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/sales-orders", new SalesOrdersRouter().router);
  return app;
};

const patch = (machine, token = "Bearer t") => {
  const req = request(buildApp()).patch(
    `/sales-orders/${ORDER_UUID}/approval/${machine}`,
  );
  if (token) req.set("Authorization", token);
  return req.send({ action: "approve" });
};

beforeEach(() => {
  grantedCodes = [];
  requirePermissionFactory.mockImplementation(fakeRequirePermission);
  setApprovalHandler.mockImplementation(fakeSetApproval);
});

describe("orderApprovalPermissionCode (the single machine→code mapping)", () => {
  it("maps each known machine to its catalogue code", () => {
    expect(orderApprovalPermissionCode("commercial")).toBe(
      "orders.approve.commercial",
    );
    expect(orderApprovalPermissionCode("financial")).toBe(
      "orders.approve.financial",
    );
    expect(ORDER_APPROVAL_MACHINES).toEqual(["commercial", "financial"]);
  });

  it.each(["fulfillment", "void", "", "COMMERCIAL", "commercial "])(
    "returns null for %p instead of falling back to a default code",
    (machine) => {
      expect(orderApprovalPermissionCode(machine)).toBeNull();
    },
  );
});

describe("PATCH /sales-orders/:uuid/approval/:machine gate (AC-8, AC-10)", () => {
  it("returns 401 without a token, and never reaches the controller", async () => {
    const res = await patch("commercial", null);

    expect(res.status).toBe(401);
    expect(setApprovalHandler).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown machine BEFORE requirePermission runs", async () => {
    grantedCodes = ["orders.approve.commercial", "orders.approve.financial"];

    const res = await patch("fulfillment");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/commercial, financial/);
    // The other five routes build their gate at construction time; what must
    // not happen is an approval gate for this request (a fallback code).
    expect(
      requirePermissionFactory.mock.calls
        .flat()
        .filter((code) => String(code).startsWith("orders.approve.")),
    ).toEqual([]);
    expect(setApprovalHandler).not.toHaveBeenCalled();
  });

  it("returns 403 without the machine's own code, and never reaches the controller", async () => {
    grantedCodes = ["orders.approve.financial"];

    const res = await patch("commercial");

    expect(res.status).toBe(403);
    expect(requirePermissionFactory).toHaveBeenCalledWith(
      "orders.approve.commercial",
    );
    expect(setApprovalHandler).not.toHaveBeenCalled();
  });

  it("passes the request through when the machine's code is granted", async () => {
    grantedCodes = ["orders.approve.financial"];

    const res = await patch("financial");

    expect(res.status).toBe(200);
    expect(requirePermissionFactory).toHaveBeenCalledWith(
      "orders.approve.financial",
    );
    expect(setApprovalHandler).toHaveBeenCalledTimes(1);
  });
});

/**
 * The three reads must be gated identically (spec.md §Gate decisions —
 * addendum). While the parent reads were `requireAdmin()` and the nested table
 * `requirePermission("orders.edit")`, a non-admin holding `orders.edit` loaded
 * the OP table underneath a pedido whose own fetch answered 403.
 */
describe("GET gating parity (sales-order-list addendum)", () => {
  const READS = [
    `/sales-orders`,
    `/sales-orders/${ORDER_UUID}`,
    `/sales-orders/${ORDER_UUID}/production-orders`,
  ];

  it.each(READS)(
    "serves %s to a non-admin holding orders.edit",
    async (path) => {
      grantedCodes = ["orders.edit"];

      const res = await request(buildApp())
        .get(path)
        .set("Authorization", "Bearer t");

      expect(res.status).toBe(200);
    },
  );

  it.each(READS)("403s %s for a caller without orders.edit", async (path) => {
    grantedCodes = [];

    const res = await request(buildApp())
      .get(path)
      .set("Authorization", "Bearer t");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/orders\.edit/);
  });
});
