// @ts-nocheck
/**
 * CorrugationClassDAO Unit Tests
 * Tests for the Corrugation Class data access layer
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  createTestCorrugationClass,
  createTestCorrugationClassResponse,
  resetIdCounter,
} from "../../mocks/factories";
import { createMockQueryBuilder } from "../../mocks/knex.mock";

// We need to create fresh mocks that persist across beforeEach
let mockQueryBuilder: any;
let mockKnex: jest.Mock<any>;

// Mock KnexManager - the factory function creates fresh mocks
jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

// Import DAO after mocking
import { CorrugationClassDAO } from "../../../dao/corrugation-class/corrugation-class.dao";

describe("CorrugationClassDAO", () => {
  let dao: CorrugationClassDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = {
      now: jest.fn().mockReturnValue(new Date().toISOString()),
    };

    dao = new CorrugationClassDAO();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("should create a new corrugation class and return it without numeric ID", async () => {
      const testData = createTestCorrugationClass();
      const _expectedResponse = createTestCorrugationClassResponse({
        uuid: testData.uuid,
        code: testData.code,
      });

      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        code: testData.code,
        description: testData.description,
      });

      expect(mockKnex).toHaveBeenCalledWith("corrugation_classes");
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        uuid: testData.uuid,
        code: testData.code,
        description: testData.description,
      });
      expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");

      // SECURITY: Verify no numeric ID in response
      expect(result).not.toHaveProperty("id");
      expect(result.uuid).toBe(testData.uuid);
      expect(result.code).toBe(testData.code);
    });
  });

  describe("getById", () => {
    it("should return corrugation class by numeric ID (internal use)", async () => {
      const testData = createTestCorrugationClass();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith("corrugation_classes");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.first).toHaveBeenCalled();

      // SECURITY: Verify no numeric ID in response
      expect(result).not.toHaveProperty("id");
      expect(result?.uuid).toBe(testData.uuid);
    });

    it("should return null when corrugation class not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe("getByUuid", () => {
    it("should return corrugation class by UUID", async () => {
      const testData = createTestCorrugationClass();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith("corrugation_classes");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "corrugation_classes.uuid",
        testData.uuid,
      );

      // SECURITY: Verify no numeric ID in response
      expect(result).not.toHaveProperty("id");
      expect(result?.uuid).toBe(testData.uuid);
      expect(result?.code).toBe(testData.code);
    });

    it("should return null when corrugation class not found by UUID", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("getIdByUuid", () => {
    it("should return internal numeric ID for a given UUID", async () => {
      const testData = createTestCorrugationClass();
      mockQueryBuilder.first.mockResolvedValue({ id: testData.id });

      const result = await dao.getIdByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith("corrugation_classes");
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        "corrugation_classes.id",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "corrugation_classes.uuid",
        testData.uuid,
      );
      expect(result).toBe(testData.id);
    });

    it("should return null when UUID not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getIdByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update corrugation class by numeric ID", async () => {
      const testData = createTestCorrugationClass();
      const updatedData = {
        ...testData,
        code: "UPDATED",
        description: "Updated description",
      };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        code: "UPDATED",
        description: "Updated description",
      });

      expect(mockKnex).toHaveBeenCalledWith("corrugation_classes");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UPDATED",
          description: "Updated description",
        }),
      );

      // SECURITY: Verify no numeric ID in response
      expect(result).not.toHaveProperty("id");
      expect(result?.code).toBe("UPDATED");
    });

    it("should return null when updating non-existent corrugation class", async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { code: "UPDATED" });

      expect(result).toBeNull();
    });

    it("should only update provided fields", async () => {
      const testData = createTestCorrugationClass();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { code: "NEW_CODE" });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ code: "NEW_CODE" }),
      );
      // Should not include description if not provided
      const updateCall = (mockQueryBuilder.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall).not.toHaveProperty("description");
    });
  });

  describe("delete", () => {
    it("should delete corrugation class by numeric ID and return true", async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith("corrugation_classes");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", 1);
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when corrugation class not found", async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return paginated corrugation classes without numeric IDs", async () => {
      const testData = [
        createTestCorrugationClass({ id: 1, code: "CC001" }),
        createTestCorrugationClass({ id: 2, code: "CC002" }),
        createTestCorrugationClass({ id: 3, code: "CC003" }),
      ];

      // Mock the data query
      mockQueryBuilder.offset.mockResolvedValue(testData);
      // Mock the count query
      mockQueryBuilder.first.mockResolvedValue({ count: "3" });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(3);
      expect(result.totalPages).toBe(1);

      // SECURITY: Verify no numeric IDs in response data
      result.data.forEach((item) => {
        expect(item).not.toHaveProperty("id");
        expect(item).toHaveProperty("uuid");
        expect(item).toHaveProperty("code");
      });
    });

    it("should calculate correct pagination", async () => {
      const testData = [createTestCorrugationClass()];
      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: "25" });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });

    it("should order by code ascending", async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith("code", "asc");
    });
  });

  describe("Security: ID Exposure Prevention", () => {
    it("should never expose numeric ID in any response", async () => {
      const testData = createTestCorrugationClass();

      // Test create
      mockQueryBuilder.returning.mockResolvedValue([testData]);
      const createResult = await dao.create({
        uuid: testData.uuid,
        code: testData.code,
      });
      expect(createResult).not.toHaveProperty("id");

      // Test getById
      mockQueryBuilder.first.mockResolvedValue(testData);
      const getByIdResult = await dao.getById(1);
      expect(getByIdResult).not.toHaveProperty("id");

      // Test getByUuid
      mockQueryBuilder.first.mockResolvedValue(testData);
      const getByUuidResult = await dao.getByUuid(testData.uuid);
      expect(getByUuidResult).not.toHaveProperty("id");

      // Test update
      mockQueryBuilder.returning.mockResolvedValue([testData]);
      const updateResult = await dao.update(1, { code: "NEW" });
      expect(updateResult).not.toHaveProperty("id");

      // Test getAll
      mockQueryBuilder.offset.mockResolvedValue([testData]);
      mockQueryBuilder.first.mockResolvedValue({ count: "1" });
      const getAllResult = await dao.getAll(1, 10);
      getAllResult.data.forEach((item) => {
        expect(item).not.toHaveProperty("id");
      });
    });
  });
});
