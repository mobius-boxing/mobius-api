// @ts-nocheck
/**
 * WarehouseController Unit Tests
 * Tests for the Warehouse API controller with grid management
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
  createTestWarehouse,
  createPaginatedResponse,
  resetIdCounter,
} from "../../mocks/factories";

// Store reference to mock functions
const mockWarehouseDAO = {
  getAllWithFilters: jest.fn(),
  getByUuid: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// Mock uuid module
jest.mock("uuid", () => ({
  v4: () => "generated-uuid",
}));

// Mock the WarehouseDAO module
// SECURITY (C2): warehouse create resolves the caller's company via CompanyDAO.
jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function () {
    return { getIdByUuid: jest.fn().mockResolvedValue(1) };
  },
}));

jest.mock("../../../dao/warehouse/warehouse.dao", () => {
  const { mockWarehouseDAO: mf } = require("./warehouse.controller.test");
  return {
    WarehouseDAO: function () {
      return {
        getAllWithFilters: (...args) => mf.getAllWithFilters(...args),
        getByUuid: (...args) => mf.getByUuid(...args),
        create: (...args) => mf.create(...args),
        update: (...args) => mf.update(...args),
        delete: (...args) => mf.delete(...args),
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
export { mockWarehouseDAO };

// Import controller after mocking
import { WarehouseController } from "../../../controllers/warehouse/warehouse.controller";

describe("WarehouseController", () => {
  let controller: WarehouseController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();

    // Reset all mock functions
    mockWarehouseDAO.getAllWithFilters.mockReset();
    mockWarehouseDAO.getByUuid.mockReset();
    mockWarehouseDAO.create.mockReset();
    mockWarehouseDAO.update.mockReset();
    mockWarehouseDAO.delete.mockReset();

    // Create controller instance
    controller = new WarehouseController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getAll", () => {
    it("should return paginated warehouses with filters", async () => {
      const testData = [
        createTestWarehouse({ name: "Warehouse A" }),
        createTestWarehouse({ name: "Warehouse B" }),
      ];
      const paginatedResult = createPaginatedResponse(testData, 1, 10, 2);

      mockWarehouseDAO.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = createPaginatedRequest(1, 10) as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockWarehouseDAO.getAllWithFilters).toHaveBeenCalledWith(mockReq);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(paginatedResult);
    });

    it("should call next with error on DAO failure", async () => {
      const error = new Error("Database error");
      mockWarehouseDAO.getAllWithFilters.mockRejectedValue(error);

      const mockReq = createPaginatedRequest() as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("getByUuid", () => {
    it("should return warehouse when found", async () => {
      const testData = createTestWarehouse();
      mockWarehouseDAO.getByUuid.mockResolvedValue(testData);

      const mockReq = createUuidParamRequest(testData.uuid) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockWarehouseDAO.getByUuid).toHaveBeenCalledWith(
        testData.uuid,
        undefined,
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: testData,
      });
    });

    it("should return 404 when warehouse not found", async () => {
      mockWarehouseDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest("non-existent-uuid") as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Warehouse not found",
      });
    });
  });

  describe("create", () => {
    it("should create warehouse with grid dimensions", async () => {
      const inputData = {
        name: "New Warehouse",
        gridRows: 10,
        gridCols: 20,
        companyId: 1,
      };
      const createdData = createTestWarehouse({
        uuid: "generated-uuid",
        name: "New Warehouse",
        gridRows: 10,
        gridCols: 20,
      });

      mockWarehouseDAO.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData, {
        user: { role: "admin", companyId: "company-uuid" },
      } as any) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockWarehouseDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: "generated-uuid",
          name: "New Warehouse",
          gridRows: 10,
          gridCols: 20,
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it("should call next with error on validation failure", async () => {
      const invalidData = { name: "", gridRows: 10, gridCols: 10 };
      const mockReq = createBodyRequest(invalidData, {
        user: { role: "admin", companyId: "company-uuid" },
      } as any) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should call next with error on DAO failure", async () => {
      const error = new Error("Database error");
      mockWarehouseDAO.create.mockRejectedValue(error);

      const mockReq = createBodyRequest({ name: "New Warehouse" }, {
        user: { role: "admin", companyId: "company-uuid" },
      } as any) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("update", () => {
    it("should update warehouse when found", async () => {
      const existingWarehouse = createTestWarehouse({
        id: 1,
        uuid: "existing-uuid",
      });
      const updateData = { name: "Updated Warehouse" };
      const updatedWarehouse = {
        ...existingWarehouse,
        name: "Updated Warehouse",
      };

      mockWarehouseDAO.getByUuid.mockResolvedValue(existingWarehouse);
      mockWarehouseDAO.update.mockResolvedValue(updatedWarehouse);

      const mockReq = {
        ...createUuidParamRequest("existing-uuid"),
        body: updateData,
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockWarehouseDAO.getByUuid).toHaveBeenCalledWith(
        "existing-uuid",
        undefined,
      );
      expect(mockWarehouseDAO.update).toHaveBeenCalledWith(
        1,
        expect.any(Object),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 when warehouse not found", async () => {
      mockWarehouseDAO.getByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest("non-existent-uuid"),
        body: { name: "Updated" },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Warehouse not found",
      });
    });
  });

  describe("delete", () => {
    it("should delete warehouse when found", async () => {
      const existingWarehouse = createTestWarehouse({ id: 1 });

      mockWarehouseDAO.getByUuid.mockResolvedValue(existingWarehouse);
      mockWarehouseDAO.delete.mockResolvedValue(true);

      const mockReq = createUuidParamRequest("existing-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockWarehouseDAO.delete).toHaveBeenCalledWith(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "Warehouse deleted successfully",
      });
    });

    it("should return 404 when warehouse not found", async () => {
      mockWarehouseDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest("non-existent-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Warehouse not found",
      });
    });

    it("should return 404 when delete fails", async () => {
      const existingWarehouse = createTestWarehouse({ id: 1 });

      mockWarehouseDAO.getByUuid.mockResolvedValue(existingWarehouse);
      mockWarehouseDAO.delete.mockResolvedValue(false);

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Failed to delete warehouse",
      });
    });

    it("should return 400 when warehouse has foreign key references", async () => {
      const existingWarehouse = createTestWarehouse({ id: 1 });
      const fkError: any = new Error("foreign key constraint violated");
      fkError.code = "23503";

      mockWarehouseDAO.getByUuid.mockResolvedValue(existingWarehouse);
      mockWarehouseDAO.delete.mockRejectedValue(fkError);

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message:
          "Cannot delete warehouse: it is referenced by other records. Please remove related data first.",
      });
    });

    it("should handle foreign key error by message", async () => {
      const existingWarehouse = createTestWarehouse({ id: 1 });
      const fkError = new Error("violates foreign key constraint");

      mockWarehouseDAO.getByUuid.mockResolvedValue(existingWarehouse);
      mockWarehouseDAO.delete.mockRejectedValue(fkError);

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it("should pass other errors to next", async () => {
      const existingWarehouse = createTestWarehouse({ id: 1 });
      const genericError = new Error("Database error");

      mockWarehouseDAO.getByUuid.mockResolvedValue(existingWarehouse);
      mockWarehouseDAO.delete.mockRejectedValue(genericError);

      const mockReq = createUuidParamRequest("test-uuid") as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(genericError);
    });
  });
});
