// @ts-nocheck
/**
 * StoreOrderController (customer-facing) — cancel endpoint tests.
 * Focused on the cancel rules:
 *   - pending order owned by caller  -> cancelled (200)
 *   - non-pending order              -> 409
 *   - another user's order           -> 404 (never reveal)
 *   - missing order                  -> 404
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Response, NextFunction } from "express";
import { createMockResponse, createMockNext } from "../../mocks/express.mock";

// --- DAO / service mocks ---
const mockOrderDAO = {
  create: jest.fn(),
  getByUuid: jest.fn(),
  getAllForStoreUser: jest.fn(),
  updateStatus: jest.fn(),
};
const mockCompanyDAO = {
  getIdByUuid: jest.fn(),
  getById: jest.fn(),
};
const mockStoreUserDAO = {
  getByUuid: jest.fn(),
};
const mockEmail = {
  sendStoreOrderNotificationEmail: jest.fn(),
  sendStoreOrderStatusEmail: jest.fn(),
};

jest.mock("../../../dao/store-order/store-order.dao", () => ({
  StoreOrderDAO: function () {
    return {
      create: (...a) => mockOrderDAO.create(...a),
      getByUuid: (...a) => mockOrderDAO.getByUuid(...a),
      getAllForStoreUser: (...a) => mockOrderDAO.getAllForStoreUser(...a),
      updateStatus: (...a) => mockOrderDAO.updateStatus(...a),
    };
  },
}));
jest.mock("../../../dao/store-box/store-box.dao", () => ({
  StoreBoxDAO: function () {
    return {};
  },
}));
jest.mock("../../../dao/store-roll/store-roll.dao", () => ({
  StoreRollDAO: function () {
    return {};
  },
}));
jest.mock("../../../dao/store-user/store-user.dao", () => ({
  StoreUserDAO: function () {
    return { getByUuid: (...a) => mockStoreUserDAO.getByUuid(...a) };
  },
}));
jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function () {
    return {
      getIdByUuid: (...a) => mockCompanyDAO.getIdByUuid(...a),
      getById: (...a) => mockCompanyDAO.getById(...a),
    };
  },
}));
jest.mock("../../../dao/user/user.dao", () => ({
  UserDAO: function () {
    return {};
  },
}));
jest.mock("../../../services/email.service", () => ({
  EmailService: function () {
    return {
      sendStoreOrderNotificationEmail: (...a) =>
        mockEmail.sendStoreOrderNotificationEmail(...a),
      sendStoreOrderStatusEmail: (...a) =>
        mockEmail.sendStoreOrderStatusEmail(...a),
    };
  },
}));

import { StoreOrderController } from "../../../controllers/store/store-order.controller";

const STORE_USER = {
  storeUserId: "store-user-uuid",
  companyId: "company-uuid",
};

const buildReq = (uuid: string) => ({
  params: { uuid },
  body: {},
  query: {},
  storeUser: STORE_USER,
});

describe("StoreOrderController.cancel", () => {
  let controller: StoreOrderController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new StoreOrderController();
    res = createMockResponse();
    next = createMockNext();

    // Default happy-path session resolution.
    mockCompanyDAO.getIdByUuid.mockResolvedValue(10);
    mockStoreUserDAO.getByUuid.mockResolvedValue({
      id: 5,
      email: "buyer@x.com",
    });
  });

  it("cancels a pending order owned by the caller (200)", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue({
      uuid: "order-uuid",
      status: "pending",
      storeUserId: 5,
    });
    mockOrderDAO.updateStatus.mockResolvedValue({
      uuid: "order-uuid",
      status: "cancelled",
      storeUserId: 5,
      items: [],
    });

    await controller.cancel(
      buildReq("order-uuid") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).toHaveBeenCalledWith(
      "order-uuid",
      10,
      "cancelled",
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: "cancelled" }),
      }),
    );
  });

  it("rejects cancelling a non-pending order (409)", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue({
      uuid: "order-uuid",
      status: "confirmed",
      storeUserId: 5,
    });

    await controller.cancel(
      buildReq("order-uuid") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Only pending orders can be cancelled",
    });
  });

  it("returns 404 for another user's order (never reveals existence)", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue({
      uuid: "order-uuid",
      status: "pending",
      storeUserId: 999, // different store user
    });

    await controller.cancel(
      buildReq("order-uuid") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Order not found",
    });
  });

  it("returns 404 when the order does not exist", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue(null);

    await controller.cancel(
      buildReq("order-uuid") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
