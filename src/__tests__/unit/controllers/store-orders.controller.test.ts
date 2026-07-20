// @ts-nocheck
/**
 * StoreOrdersController (admin) — updateStatus transition-enforcement tests.
 * Verifies the server-side state machine is enforced:
 *   - legal transition (pending -> confirmed) updates + notifies buyer (200)
 *   - illegal transition (pending -> shipped) -> 409 Invalid status transition
 *   - missing order -> 404
 *   - invalid status value -> 400
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Response, NextFunction } from "express";
import { createMockResponse, createMockNext } from "../../mocks/express.mock";

const mockOrderDAO = {
  getByUuid: jest.fn(),
  updateStatus: jest.fn(),
  getAllForCompany: jest.fn(),
};
const mockCompanyDAO = {
  getIdByUuid: jest.fn(),
  getById: jest.fn(),
};
const mockEmail = {
  sendStoreOrderStatusEmail: jest.fn(),
};

jest.mock("../../../dao/store-order/store-order.dao", () => ({
  StoreOrderDAO: function () {
    return {
      getByUuid: (...a) => mockOrderDAO.getByUuid(...a),
      updateStatus: (...a) => mockOrderDAO.updateStatus(...a),
      getAllForCompany: (...a) => mockOrderDAO.getAllForCompany(...a),
    };
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
jest.mock("../../../services/email.service", () => ({
  EmailService: function () {
    return {
      sendStoreOrderStatusEmail: (...a) =>
        mockEmail.sendStoreOrderStatusEmail(...a),
    };
  },
}));

import { StoreOrdersController } from "../../../controllers/store-orders/store-orders.controller";

const ADMIN_USER = { role: "admin", companyId: "company-uuid" };

const buildReq = (status: string) => ({
  params: { uuid: "order-uuid" },
  body: { status },
  query: {},
  user: ADMIN_USER,
});

describe("StoreOrdersController.updateStatus", () => {
  let controller: StoreOrdersController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new StoreOrdersController();
    res = createMockResponse();
    next = createMockNext();

    mockCompanyDAO.getIdByUuid.mockResolvedValue(10);
    mockCompanyDAO.getById.mockResolvedValue({ id: 10, name: "Acme" });
  });

  it("applies a legal transition and notifies the buyer (200)", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue({
      uuid: "order-uuid",
      status: "pending",
    });
    mockOrderDAO.updateStatus.mockResolvedValue({
      uuid: "order-uuid",
      status: "confirmed",
      storeUserEmail: "buyer@x.com",
      items: [],
    });

    await controller.updateStatus(
      buildReq("confirmed") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).toHaveBeenCalledWith(
      "order-uuid",
      10,
      "confirmed",
    );
    expect(mockEmail.sendStoreOrderStatusEmail).toHaveBeenCalledWith(
      "buyer@x.com",
      expect.objectContaining({ status: "confirmed", orderUuid: "order-uuid" }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects an illegal transition with 409 (and does not write)", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue({
      uuid: "order-uuid",
      status: "pending",
    });

    await controller.updateStatus(
      buildReq("shipped") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid status transition",
    });
  });

  it("allows admin cancel while pending (200)", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue({
      uuid: "order-uuid",
      status: "pending",
    });
    mockOrderDAO.updateStatus.mockResolvedValue({
      uuid: "order-uuid",
      status: "cancelled",
      storeUserEmail: "buyer@x.com",
      items: [],
    });

    await controller.updateStatus(
      buildReq("cancelled") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).toHaveBeenCalledWith(
      "order-uuid",
      10,
      "cancelled",
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 404 when the order is missing", async () => {
    mockOrderDAO.getByUuid.mockResolvedValue(null);

    await controller.updateStatus(
      buildReq("confirmed") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.updateStatus).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 for an invalid status value", async () => {
    await controller.updateStatus(
      buildReq("bogus") as any,
      res as Response,
      next,
    );

    expect(mockOrderDAO.getByUuid).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid status",
    });
  });
});
