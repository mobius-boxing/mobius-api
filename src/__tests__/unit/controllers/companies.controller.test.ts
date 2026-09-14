// @ts-nocheck
/**
 * CompaniesController Unit Tests
 * Tests for the Companies API controller
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
  createPaginatedRequest,
  createUuidParamRequest,
  createBodyRequest,
} from "../../mocks/express.mock";
import {
  createTestCompany,
  createPaginatedResponse,
  resetIdCounter,
} from "../../mocks/factories";

// Store reference to mock functions
const mockCompanyDAO = {
  getAll: jest.fn(),
  getAllWithFilters: jest.fn(),
  getByUuid: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  getCompanyWithUserCount: jest.fn(),
};

/**
 * Company deletion goes through the purge service, never `CompanyDAO.delete`
 * (audit P2 / §P2.7): the ledger is append-only in the database, so the delete
 * only succeeds inside a transaction that turned maintenance mode on. Asserting
 * the call here is what stops the raw DAO delete from creeping back.
 */
export const mockPurgeCompany = jest.fn();

jest.mock("../../../services/company-purge.service", () => ({
  __esModule: true,
  purgeCompany: (...args) =>
    require("./companies.controller.test").mockPurgeCompany(...args),
}));

/**
 * T10: `delete` now checks for a live `tenant_databases` row before choosing
 * between the decommission path and the pre-T10 plain purge; `create` starts
 * provisioning. Both are mocked here so this file stays a controller unit
 * test — no real `db("core")` call — and defaults to "no live row" / "could
 * not start provisioning", which is exactly the pre-T10 behavior these
 * existing cases assert.
 */
const mockTenantDatabaseDAO = { getLiveByCompanyId: jest.fn() };
export const mockBeginProvisioning = jest.fn();
export const mockRunProvisioningSteps = jest.fn();
export const mockDecommissionTenantDatabase = jest.fn();

jest.mock("../../../dao/tenant-database/tenant-database.dao", () => ({
  __esModule: true,
  TenantDatabaseDAO: function () {
    return {
      getLiveByCompanyId: (...args) =>
        mockTenantDatabaseDAO.getLiveByCompanyId(...args),
    };
  },
}));

jest.mock("../../../services/tenant-provisioning.service", () => ({
  __esModule: true,
  beginProvisioning: (...args) =>
    require("./companies.controller.test").mockBeginProvisioning(...args),
  runProvisioningSteps: (...args) =>
    require("./companies.controller.test").mockRunProvisioningSteps(...args),
  decommissionTenantDatabase: (...args) =>
    require("./companies.controller.test").mockDecommissionTenantDatabase(
      ...args,
    ),
}));

// Mock uuid module
jest.mock("uuid", () => ({
  v4: () => "generated-uuid",
}));

// Mock the CompanyDAO module
jest.mock("../../../dao/company/company.dao", () => {
  const { mockCompanyDAO: mf } = require("./companies.controller.test");
  return {
    CompanyDAO: function () {
      return {
        getAll: (...args) => mf.getAll(...args),
        getAllWithFilters: (...args) => mf.getAllWithFilters(...args),
        getByUuid: (...args) => mf.getByUuid(...args),
        create: (...args) => mf.create(...args),
        update: (...args) => mf.update(...args),
        delete: (...args) => mf.delete(...args),
        getCompanyWithUserCount: (...args) =>
          mf.getCompanyWithUserCount(...args),
      };
    },
  };
});

// Mock the @sundaysf/utils module
jest.mock("@sundaysf/utils", () => ({
  paginationHelper: (req: any) => ({
    page: req.query?.page ? parseInt(req.query.page) : 1,
    limit: req.query?.limit ? parseInt(req.query.limit) : 10,
  }),
  inputValidator: async (dto: any) => {
    if (!dto.name || dto.name.trim() === "") {
      return { success: false, message: "Name is required" };
    }
    return { success: true, message: "" };
  },
}));

// Export mock functions for access in the mock
export { mockCompanyDAO };

// Import controller after mocking
import { CompaniesController } from "../../../controllers/companies/companies.controller";

describe("CompaniesController", () => {
  let controller: CompaniesController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();

    // Reset all mock functions
    mockCompanyDAO.getAll.mockReset();
    mockCompanyDAO.getAllWithFilters.mockReset();
    mockCompanyDAO.getByUuid.mockReset();
    mockCompanyDAO.create.mockReset();
    mockCompanyDAO.update.mockReset();
    mockCompanyDAO.delete.mockReset();
    mockCompanyDAO.getCompanyWithUserCount.mockReset();

    // T10: default to "no live tenant row" / "could not start provisioning" —
    // the pre-T10 behavior every existing case here assumes. A test that
    // wants the new decommission/provisioning path overrides these.
    mockTenantDatabaseDAO.getLiveByCompanyId
      .mockReset()
      .mockResolvedValue(null);
    mockBeginProvisioning.mockReset().mockResolvedValue({
      ok: false,
      code: "SERVER_NOT_FOUND",
      reason: "no default-placement db_servers row",
      row: null,
    });
    mockRunProvisioningSteps.mockReset();
    mockDecommissionTenantDatabase.mockReset();

    // Create controller instance
    controller = new CompaniesController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getAll", () => {
    it("should return paginated companies", async () => {
      const testData = [
        createTestCompany({ name: "Company A" }),
        createTestCompany({ name: "Company B" }),
      ];
      const paginatedResult = createPaginatedResponse(testData, 1, 10, 2);

      mockCompanyDAO.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = createPaginatedRequest(1, 10) as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getAllWithFilters).toHaveBeenCalledWith(mockReq);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(paginatedResult);
    });

    it("should call next with error on DAO failure", async () => {
      const error = new Error("Database error");
      mockCompanyDAO.getAllWithFilters.mockRejectedValue(error);

      const mockReq = createPaginatedRequest() as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("getByUuid", () => {
    it("should return company when found", async () => {
      const testData = createTestCompany();
      mockCompanyDAO.getByUuid.mockResolvedValue(testData);

      const mockReq = createUuidParamRequest(testData.uuid) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith(testData.uuid);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: testData,
      });
    });

    it("should return 404 when company not found", async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest("non-existent-uuid") as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Company not found",
      });
    });
  });

  describe("create", () => {
    it("should create company with valid input", async () => {
      const inputData = { name: "New Company", description: "Description" };
      const createdData = createTestCompany({
        uuid: "generated-uuid",
        name: "New Company",
        description: "Description",
      });

      mockCompanyDAO.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: "generated-uuid",
          name: "New Company",
          isActive: true,
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it("should call next with error on validation failure", async () => {
      const invalidData = { name: "", description: "Test" };
      const mockReq = createBodyRequest(invalidData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should call next with error on DAO failure", async () => {
      const error = new Error("Database error");
      mockCompanyDAO.create.mockRejectedValue(error);

      const mockReq = createBodyRequest({ name: "New Company" }) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it("T10/AC-62: response includes tenantDatabase{status,placement} and fires provisioning without awaiting it", async () => {
      const createdData = createTestCompany({ id: 1, uuid: "generated-uuid" });
      mockCompanyDAO.create.mockResolvedValue(createdData);
      const provisioningRow = { id: 55, status: "provisioning" };
      const server = { kind: "shared_container" };
      mockBeginProvisioning.mockResolvedValue({
        ok: true,
        row: provisioningRow,
        server,
        companyUuid: createdData.uuid,
        needsRun: true,
      });
      let resolveRun: (v: unknown) => void = () => undefined;
      mockRunProvisioningSteps.mockReturnValue(
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
      );

      const mockReq = createBodyRequest({ name: "New Company" }) as Request;
      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockBeginProvisioning).toHaveBeenCalledWith(1, {
        deferServerPreconditions: true,
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      const body: any = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(body.data.tenantDatabase).toEqual({
        status: "provisioning",
        placement: "shared_container",
      });
      resolveRun({ ok: true, row: { ...provisioningRow, status: "active" } });
    });

    it("T10/AC-62: company creation still succeeds (201) when provisioning could not even start", async () => {
      const createdData = createTestCompany({ id: 1, uuid: "generated-uuid" });
      mockCompanyDAO.create.mockResolvedValue(createdData);
      mockBeginProvisioning.mockResolvedValue({
        ok: false,
        code: "SERVER_NOT_FOUND",
        reason: "no default-placement db_servers row",
        row: null,
      });

      const mockReq = createBodyRequest({ name: "New Company" }) as Request;
      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      const body: any = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(body.data.tenantDatabase).toBeNull();
      expect(mockRunProvisioningSteps).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update company when found", async () => {
      const existingCompany = createTestCompany({
        id: 1,
        uuid: "existing-uuid",
      });
      const updateData = { name: "Updated Name" };
      const updatedCompany = { ...existingCompany, name: "Updated Name" };

      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockCompanyDAO.update.mockResolvedValue(updatedCompany);

      const mockReq = {
        ...createUuidParamRequest("existing-uuid"),
        body: updateData,
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith("existing-uuid");
      expect(mockCompanyDAO.update).toHaveBeenCalledWith(1, expect.any(Object));
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 when company not found", async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest("non-existent-uuid"),
        body: { name: "Updated" },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Company not found",
      });
    });

    it("should return 404 when company has no id", async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue({
        uuid: "test",
        name: "Test",
      }); // no id

      const mockReq = {
        ...createUuidParamRequest("test-uuid"),
        body: { name: "Updated" },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe("delete", () => {
    it("should delete company when found", async () => {
      const existingCompany = createTestCompany({
        id: 1,
        uuid: "existing-uuid",
      });

      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockPurgeCompany.mockResolvedValue({
        companyDeleted: true,
        ledgerRowsDeleted: 7,
      });

      const mockReq = createUuidParamRequest("existing-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith("existing-uuid");
      expect(mockPurgeCompany).toHaveBeenCalledWith(1);
      expect(mockCompanyDAO.delete).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "Company deleted successfully",
      });
    });

    it("should return 404 when company not found", async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest("non-existent-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Company not found",
      });
    });

    it("should return 404 when delete fails", async () => {
      const existingCompany = createTestCompany({ id: 1 });

      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockPurgeCompany.mockResolvedValue({
        companyDeleted: false,
        ledgerRowsDeleted: 0,
      });

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Failed to delete company",
      });
    });

    it("T10/AC-63: decommissions through decommissionTenantDatabase when a live tenant row exists", async () => {
      const existingCompany = createTestCompany({
        id: 1,
        uuid: "existing-uuid",
      });
      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue({
        id: 55,
        status: "active",
      });
      mockDecommissionTenantDatabase.mockResolvedValue({
        ok: true,
        companyDeleted: true,
      });

      const mockReq = createUuidParamRequest("existing-uuid") as Request;
      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockDecommissionTenantDatabase).toHaveBeenCalledWith(1);
      expect(mockPurgeCompany).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "Company deleted successfully",
      });
    });

    it("T10/AC-63: 500s TENANT_DECOMMISSION_FAILED when decommissionTenantDatabase reports ok:false", async () => {
      const existingCompany = createTestCompany({
        id: 1,
        uuid: "existing-uuid",
      });
      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue({
        id: 55,
        status: "active",
      });
      mockDecommissionTenantDatabase.mockResolvedValue({
        ok: false,
        reason: "db_servers #9 not found",
      });

      const mockReq = createUuidParamRequest("existing-uuid") as Request;
      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: "TENANT_DECOMMISSION_FAILED",
        }),
      );
    });

    it("T10/AC-63: 500s TENANT_DECOMMISSION_FAILED when decommissionTenantDatabase throws, and a repeat call can still succeed", async () => {
      const existingCompany = createTestCompany({
        id: 1,
        uuid: "existing-uuid",
      });
      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue({
        id: 55,
        status: "decommissioning",
      });
      mockDecommissionTenantDatabase.mockRejectedValueOnce(
        new Error("connection refused"),
      );

      const mockReq = createUuidParamRequest("existing-uuid") as Request;
      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "TENANT_DECOMMISSION_FAILED" }),
      );

      // Repeat DELETE (model, AC-63: "a repeat DELETE completes") — the same
      // still-live/decommissioning row, this time the operation succeeds.
      mockDecommissionTenantDatabase.mockResolvedValueOnce({
        ok: true,
        companyDeleted: true,
      });
      const retryRes = createMockResponse();
      await controller.delete(mockReq, retryRes as Response, mockNext);

      expect(retryRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getWithUserCount", () => {
    it("should return company with user count", async () => {
      const companyWithCount = {
        ...createTestCompany(),
        userCount: 5,
      };

      mockCompanyDAO.getCompanyWithUserCount.mockResolvedValue(
        companyWithCount,
      );

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.getWithUserCount(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getCompanyWithUserCount).toHaveBeenCalledWith(
        "test-uuid",
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: companyWithCount,
      });
    });

    it("should return 404 when company not found", async () => {
      mockCompanyDAO.getCompanyWithUserCount.mockResolvedValue(null);

      const mockReq = createUuidParamRequest("non-existent-uuid") as Request;

      await controller.getWithUserCount(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Company not found",
      });
    });

    it("should call next with error on DAO failure", async () => {
      const error = new Error("Database error");
      mockCompanyDAO.getCompanyWithUserCount.mockRejectedValue(error);

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.getWithUserCount(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
