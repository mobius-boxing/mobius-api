// @ts-nocheck
/**
 * UsersController.update — the company-actor PUT rules for role management:
 * `role`/`roleId` in the body are ignored (not rejected — assignment moves
 * only through `/roles/assign`), and `isActive` is now allowed for a company
 * actor, guarded by the LAST_ADMIN rule.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import {
  createMockResponse,
  createMockNext,
  createUuidParamRequest,
} from "../../mocks/express.mock";
import { createTestUser, resetIdCounter } from "../../mocks/factories";

const mockUserDAO = {
  getByUuid: jest.fn(),
  update: jest.fn(),
  setActiveChecked: jest.fn(),
};
const mockCompanyDAO = { getById: jest.fn(), getByUuid: jest.fn() };

jest.mock("../../../dao/user/user.dao", () => {
  const { mockUserDAO: mf } = require("./users.controller.put-rules.test");
  return {
    UserDAO: function () {
      return {
        getByUuid: (...args) => mf.getByUuid(...args),
        update: (...args) => mf.update(...args),
        setActiveChecked: (...args) => mf.setActiveChecked(...args),
      };
    },
  };
});
jest.mock("../../../dao/invitation/invitation.dao", () => ({
  InvitationDAO: function () {
    return { create: jest.fn() };
  },
}));
jest.mock("../../../dao/company/company.dao", () => {
  const { mockCompanyDAO: mf } = require("./users.controller.put-rules.test");
  return {
    CompanyDAO: function () {
      return {
        getById: (...args) => mf.getById(...args),
        getByUuid: (...args) => mf.getByUuid(...args),
      };
    },
  };
});
jest.mock("../../../services/email.service", () => ({
  EmailService: function () {
    return { sendInvitationEmail: jest.fn() };
  },
}));
jest.mock("@sundaysf/utils", () => ({
  paginationHelper: () => ({ page: 1, limit: 10 }),
  inputValidator: async () => ({ success: true, message: "" }),
}));

export { mockUserDAO, mockCompanyDAO };

import { UsersController } from "../../../controllers/users/users.controller";

describe("UsersController.update — company-actor rules", () => {
  let controller: UsersController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    mockUserDAO.getByUuid.mockReset();
    mockUserDAO.update.mockReset();
    mockUserDAO.setActiveChecked.mockReset();
    mockCompanyDAO.getById.mockReset();
    controller = new UsersController();
  });

  afterEach(() => jest.clearAllMocks());

  const companyActor = {
    userId: "admin-uuid",
    role: "admin",
    companyId: "company-uuid",
  };

  it("ignores role/roleId in the body instead of rejecting the request", async () => {
    const existing = createTestUser({
      id: 1,
      uuid: "target-uuid",
      companyId: 5,
      role: "member",
      isActive: true,
    });
    mockUserDAO.getByUuid.mockResolvedValue(existing);
    mockCompanyDAO.getById.mockResolvedValue({ uuid: "company-uuid" });
    mockUserDAO.update.mockResolvedValue({ ...existing, firstName: "New" });

    const mockReq = {
      ...createUuidParamRequest("target-uuid"),
      user: companyActor,
      body: { firstName: "New", role: "admin", roleId: 999 },
    } as unknown as Request;

    await controller.update(mockReq, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const payload = mockUserDAO.update.mock.calls[0][1];
    expect(payload.role).toBeUndefined();
    expect(payload.roleId).toBeUndefined();
  });

  it("allows a company actor to deactivate a user (isActive: false) via the checked path", async () => {
    const existing = createTestUser({
      id: 1,
      uuid: "target-uuid",
      companyId: 5,
      role: "member",
      isActive: true,
    });
    mockUserDAO.getByUuid.mockResolvedValue(existing);
    mockCompanyDAO.getById.mockResolvedValue({ uuid: "company-uuid" });
    mockUserDAO.setActiveChecked.mockResolvedValue({
      ...existing,
      isActive: false,
    });

    const mockReq = {
      ...createUuidParamRequest("target-uuid"),
      user: companyActor,
      body: { isActive: false },
    } as unknown as Request;

    await controller.update(mockReq, mockRes as Response, mockNext);

    expect(mockUserDAO.setActiveChecked).toHaveBeenCalledWith(
      1,
      5,
      false,
      false, // existing.role === "member", not "admin"
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it("answers 409 LAST_ADMIN when the DAO's guard rejects the deactivation", async () => {
    const existing = createTestUser({
      id: 1,
      uuid: "target-uuid",
      companyId: 5,
      role: "admin",
      isActive: true,
    });
    mockUserDAO.getByUuid.mockResolvedValue(existing);
    mockCompanyDAO.getById.mockResolvedValue({ uuid: "company-uuid" });
    const err: any = new Error("Cannot remove the last active Admin.");
    err.code = "LAST_ADMIN";
    err.status = 409;
    mockUserDAO.setActiveChecked.mockRejectedValue(err);

    const mockReq = {
      ...createUuidParamRequest("target-uuid"),
      user: companyActor,
      body: { isActive: false },
    } as unknown as Request;

    await controller.update(mockReq, mockRes as Response, mockNext);

    expect(mockUserDAO.setActiveChecked).toHaveBeenCalledWith(
      1,
      5,
      false,
      true,
    );
    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: "LAST_ADMIN" }),
    );
  });
});
