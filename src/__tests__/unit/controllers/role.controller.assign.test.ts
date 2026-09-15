// @ts-nocheck
/**
 * RoleController.assign — `PUT /roles/assign`.
 *
 * `roleUuid` is required (a `null` role no longer unassigns), and every
 * invariant check (own-assignment, ceiling, last-Admin) must fire BEFORE the
 * write — each case below fails if that check is dropped (L-018). Only
 * `RbacService.authzForUserUuid` is stubbed (the DB-touching call); the
 * ceiling/own-role decisions run for real through RolePolicyService.
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
  createBodyRequest,
} from "../../mocks/express.mock";
import { RbacService } from "../../../services/rbac.service";
import { RolePolicyError } from "../../../services/role-policy.service";

const mockRoleDAO = {
  getByUuid: jest.fn(),
  getById: jest.fn(),
  currentAssignment: jest.fn(),
  assign: jest.fn(),
  resolveCompanyId: jest.fn(),
};
const mockUserDAO = { getByUuid: jest.fn() };

jest.mock("../../../dao/role/role.dao", () => ({
  RoleDAO: function () {
    return mockRoleDAO;
  },
}));
jest.mock("../../../dao/user/user.dao", () => ({
  UserDAO: function () {
    return mockUserDAO;
  },
}));

import { RoleController } from "../../../controllers/role/role.controller";

const ADMIN_ROLE = {
  id: 10,
  uuid: "admin-role-uuid",
  companyId: 5,
  systemKey: "admin",
  permissionCodes: ["orders.edit", "orders.delete", "users.edit"],
};
const MEMBER_ROLE = {
  id: 11,
  uuid: "member-role-uuid",
  companyId: 5,
  systemKey: "member",
  permissionCodes: ["orders.edit"],
};

const ACTOR = {
  userId: "actor-uuid",
  role: "admin",
  companyId: "company-uuid",
};
const TARGET_USER = { id: 2, uuid: "target-uuid", companyId: 5 };

describe("RoleController.assign", () => {
  let controller: RoleController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    res = createMockResponse();
    next = createMockNext();
    controller = new RoleController();
    mockUserDAO.getByUuid.mockResolvedValue(TARGET_USER);
    mockRoleDAO.currentAssignment.mockResolvedValue({
      roleId: null,
      isActive: true,
      systemKey: null,
    });
    jest.spyOn(RbacService, "authzForUserUuid").mockResolvedValue({
      hasRole: true,
      codes: ["orders.edit", "orders.delete", "users.edit"],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  // `companyId` (numeric) simulates what `resolveTenantContext` middleware
  // sets on a real request — `companyFilterScope` reads it, not the JWT uuid.
  const req = (body: any) =>
    ({
      ...createBodyRequest(body),
      user: ACTOR,
      companyId: 5,
    }) as unknown as Request;

  it("400s when roleUuid is missing (a null role is now a 400, not an unassign)", async () => {
    await controller.assign(
      req({ userUuid: "target-uuid" }),
      res as Response,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRoleDAO.assign).not.toHaveBeenCalled();
  });

  it("403s OWN_ROLE when the actor assigns themselves (mutation: skipping this lets self-escalation through)", async () => {
    mockUserDAO.getByUuid.mockResolvedValue({
      id: 1,
      uuid: "actor-uuid",
      companyId: 5,
    });
    mockRoleDAO.getByUuid.mockResolvedValue(MEMBER_ROLE);

    await controller.assign(
      req({ userUuid: "actor-uuid", roleUuid: "member-role-uuid" }),
      res as Response,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "OWN_ROLE" }),
    );
    expect(mockRoleDAO.assign).not.toHaveBeenCalled();
  });

  it("403s GRANT_CEILING when the target role holds a code the actor lacks", async () => {
    mockRoleDAO.getByUuid.mockResolvedValue(ADMIN_ROLE);
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockResolvedValue({ hasRole: true, codes: ["orders.edit"] }); // missing orders.delete, users.edit

    await controller.assign(
      req({ userUuid: "target-uuid", roleUuid: "admin-role-uuid" }),
      res as Response,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "GRANT_CEILING" }),
    );
    expect(mockRoleDAO.assign).not.toHaveBeenCalled();
  });

  it("assigns when the actor's codes cover the target role's, writing roleId + the systemKey mirror", async () => {
    mockRoleDAO.getByUuid.mockResolvedValue(MEMBER_ROLE);

    await controller.assign(
      req({ userUuid: "target-uuid", roleUuid: "member-role-uuid" }),
      res as Response,
      next,
    );

    expect(mockRoleDAO.assign).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        companyId: 5,
        roleId: 11,
        roleSystemKey: "member",
        leavingActiveAdmin: false,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("computes leavingActiveAdmin when an active Admin is reassigned to a different role", async () => {
    mockRoleDAO.getByUuid.mockResolvedValue(MEMBER_ROLE);
    mockRoleDAO.currentAssignment.mockResolvedValue({
      roleId: ADMIN_ROLE.id,
      isActive: true,
      systemKey: "admin",
    });
    mockRoleDAO.getById.mockResolvedValue(ADMIN_ROLE);

    await controller.assign(
      req({ userUuid: "target-uuid", roleUuid: "member-role-uuid" }),
      res as Response,
      next,
    );

    expect(mockRoleDAO.assign).toHaveBeenCalledWith(
      expect.objectContaining({ leavingActiveAdmin: true }),
    );
  });

  it("propagates LAST_ADMIN (409) from the DAO's transactional guard", async () => {
    mockRoleDAO.getByUuid.mockResolvedValue(MEMBER_ROLE);
    mockRoleDAO.currentAssignment.mockResolvedValue({
      roleId: ADMIN_ROLE.id,
      isActive: true,
      systemKey: "admin",
    });
    mockRoleDAO.getById.mockResolvedValue(ADMIN_ROLE);
    mockRoleDAO.assign.mockRejectedValue(
      new RolePolicyError(
        "LAST_ADMIN",
        "Cannot remove the company's last active Admin.",
      ),
    );

    await controller.assign(
      req({ userUuid: "target-uuid", roleUuid: "member-role-uuid" }),
      res as Response,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LAST_ADMIN" }),
    );
  });

  it("superAdmin is exempt from the ceiling rule", async () => {
    mockRoleDAO.getByUuid.mockResolvedValue(ADMIN_ROLE);
    const superAdminReq = {
      ...createBodyRequest({
        userUuid: "target-uuid",
        roleUuid: "admin-role-uuid",
      }),
      user: { userId: "super-uuid", role: "superAdmin" },
    } as unknown as Request;

    await controller.assign(superAdminReq, res as Response, next);

    expect(mockRoleDAO.assign).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
