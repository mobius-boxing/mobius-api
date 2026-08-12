// @ts-nocheck
/**
 * PaperTypeDAO Unit Tests
 * Tests for the Paper Type data access layer
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTestPaperType, resetIdCounter } from "../../mocks/factories";
import { createMockQueryBuilder } from "../../mocks/knex.mock";

// We need to create fresh mocks that persist across beforeEach
let mockQueryBuilder: any;
let mockKnex: jest.Mock<any>;

jest.mock("../../../database/KnexConnection", () => ({
  __esModule: true,
  default: {
    getConnection: () => mockKnex,
  },
}));

// Import DAO after mocking
import { PaperTypeDAO } from "../../../dao/paper-type/paper-type.dao";

describe("PaperTypeDAO", () => {
  let dao: PaperTypeDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = {
      now: jest.fn().mockReturnValue(new Date().toISOString()),
    };

    dao = new PaperTypeDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("create", () => {
    it("should create a new paper type and return it", async () => {
      const testData = createTestPaperType();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        code: testData.code,
        description: testData.description,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith("paper_types");
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        uuid: testData.uuid,
        code: testData.code,
        description: testData.description,
      });
      expect(result.code).toBe(testData.code);
      expect(result.uuid).toBe(testData.uuid);
    });
  });

  describe("getById", () => {
    it("should return paper type by numeric ID", async () => {
      const testData = createTestPaperType();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith("paper_types");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(result?.code).toBe(testData.code);
    });

    it("should return null when paper type not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe("getByUuid", () => {
    it("should return paper type by UUID", async () => {
      const testData = createTestPaperType();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "paper_types.uuid",
        testData.uuid,
      );
      expect(result?.code).toBe(testData.code);
    });

    it("should return null when paper type not found by UUID", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update paper type by numeric ID", async () => {
      const testData = createTestPaperType();
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

      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UPDATED",
          description: "Updated description",
        }),
      );
      expect(result?.code).toBe("UPDATED");
    });

    it("should only update provided fields", async () => {
      const testData = createTestPaperType();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { code: "NEW_CODE" });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall).toHaveProperty("code", "NEW_CODE");
      expect(updateCall).not.toHaveProperty("description");
    });

    it("should return null when updating non-existent paper type", async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { code: "UPDATED" });

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete paper type by numeric ID and return true", async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith("paper_types");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", 1);
      expect(result).toBe(true);
    });

    it("should return false when paper type not found", async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return paginated paper types", async () => {
      const testData = [
        createTestPaperType({ id: 1, code: "PT001" }),
        createTestPaperType({ id: 2, code: "PT002" }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: "2" });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it("should order by code ascending", async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith("code", "asc");
    });

    it("should calculate correct pagination", async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestPaperType()]);
      mockQueryBuilder.first.mockResolvedValue({ count: "25" });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });
  });
});
