// @ts-nocheck
/**
 * ProductController.setApproval cascade — the authorization gate and the
 * transactional parts-first ordering (module 06 §04 + Sprint 2 review fixes).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockProductDAO = {
  getIdByUuid: jest.fn(),
  setApproval: jest.fn(),
};
const mockPartDAOInstance = {
  cascadeApprovalTrx: jest.fn(),
};
let mockUserHasPermission;
let mockKnex;

jest.mock("../../../dao/product/product.dao", () => ({
  // Plain function constructor (house pattern) — `new jest.fn(() => obj)()`
  // does not reliably return obj across jest versions.
  ProductDAO: function () {
    return {
      getIdByUuid: (...a) => mockProductDAO.getIdByUuid(...a),
      setApproval: (...a) => mockProductDAO.setApproval(...a),
    };
  },
}));
jest.mock("../../../dao/part/part.dao", () => ({
  PartDAO: function () {
    return {
      cascadeApprovalTrx: (...a) => mockPartDAOInstance.cascadeApprovalTrx(...a),
    };
  },
}));
jest.mock("../../../services/rbac.service", () => ({
  RbacService: {
    userHasPermission: (...args) => mockUserHasPermission(...args),
  },
}));
jest.mock("../../../services/audit.service", () => ({
  AuditService: function () {
    return { record: () => Promise.resolve(undefined) };
  },
}));
jest.mock("../../../database/KnexConnection", () => ({
  __esModule: true,
  default: { getConnection: () => mockKnex },
}));

import { ProductController } from "../../../controllers/product/product.controller";

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => ((res.statusCode = code), res));
  res.json = jest.fn((payload) => ((res.body = payload), res));
  return res;
};

const makeReq = (body, user = { userId: "u-1", email: "a@x", role: "member", companyId: "c-1" }) => ({
  params: { uuid: "prod-uuid" },
  body,
  query: {},
  user,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProductDAO.getIdByUuid.mockResolvedValue(3);
  mockProductDAO.setApproval.mockResolvedValue({ uuid: "prod-uuid", productApprovalAt: "t" });
  mockPartDAOInstance.cascadeApprovalTrx.mockResolvedValue([11, 12]);
  mockUserHasPermission = jest.fn().mockResolvedValue(true);
  const countBuilder = {
    where: jest.fn(() => countBuilder),
    count: jest.fn(() => countBuilder),
    first: jest.fn().mockResolvedValue({ count: "2" }),
  };
  mockKnex = jest.fn(() => countBuilder);
  mockKnex.transaction = jest.fn(async (cb) => cb("TRX"));
});

describe("ProductController.setApproval cascade", () => {
  it("403s cascade:true without parts.approve.part (no transaction, no product write)", async () => {
    mockUserHasPermission.mockResolvedValue(false);
    const controller = new ProductController();
    const res = makeRes();
    await controller.setApproval(makeReq({ action: "approve", cascade: true }), res, jest.fn());
    expect(res.statusCode).toBe(403);
    expect(mockKnex.transaction).not.toHaveBeenCalled();
    expect(mockProductDAO.setApproval).not.toHaveBeenCalled();
    expect(mockUserHasPermission).toHaveBeenCalledWith("u-1", "member", "parts.approve.part");
  });

  it("cascade runs in ONE transaction, parts FIRST, product last", async () => {
    const controller = new ProductController();
    const res = makeRes();
    await controller.setApproval(makeReq({ action: "approve", cascade: true }), res, jest.fn());
    expect(res.statusCode).toBe(200);
    expect(mockKnex.transaction).toHaveBeenCalledTimes(1);
    expect(mockPartDAOInstance.cascadeApprovalTrx).toHaveBeenCalledWith("TRX", 3, "approve", "a@x");
    expect(mockProductDAO.setApproval).toHaveBeenCalledWith(3, "approve", "a@x", "TRX");
    // Ordering: parts before product.
    const partsOrder = mockPartDAOInstance.cascadeApprovalTrx.mock.invocationCallOrder[0];
    const productOrder = mockProductDAO.setApproval.mock.invocationCallOrder[0];
    expect(partsOrder).toBeLessThan(productOrder);
    expect(res.body.cascaded).toBe(2);
  });

  it("400s a cascade over 500 parts", async () => {
    mockKnex.mockImplementation(() => ({
      where: jest.fn().mockReturnThis(),
      count: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ count: "501" }),
    }));
    const controller = new ProductController();
    const res = makeRes();
    await controller.setApproval(makeReq({ action: "approve", cascade: true }), res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(mockKnex.transaction).not.toHaveBeenCalled();
  });

  it("without cascade, only the product is written (no permission check, no partDAO)", async () => {
    const controller = new ProductController();
    const res = makeRes();
    await controller.setApproval(makeReq({ action: "cancel" }), res, jest.fn());
    expect(res.statusCode).toBe(200);
    expect(mockUserHasPermission).not.toHaveBeenCalled();
    expect(mockPartDAOInstance.cascadeApprovalTrx).not.toHaveBeenCalled();
    expect(mockProductDAO.setApproval).toHaveBeenCalledWith(3, "cancel", "a@x");
  });
});
