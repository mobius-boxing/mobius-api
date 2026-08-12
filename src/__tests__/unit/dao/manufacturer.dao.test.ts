// @ts-nocheck
/**
 * ManufacturerDAO Unit Tests
 * Tests for the Manufacturer data access layer
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTestManufacturer, resetIdCounter } from "../../mocks/factories";
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
import { ManufacturerDAO } from "../../../dao/manufacturer/manufacturer.dao";

describe("ManufacturerDAO", () => {
  let dao: ManufacturerDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = {
      now: jest.fn().mockReturnValue(new Date().toISOString()),
    };

    dao = new ManufacturerDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("create", () => {
    it("should create a new manufacturer and return it", async () => {
      const testData = createTestManufacturer();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        code: testData.code,
        name: testData.name,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith("manufacturers");
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        uuid: testData.uuid,
        code: testData.code,
        name: testData.name,
      });
      expect(result.code).toBe(testData.code);
      expect(result.name).toBe(testData.name);
    });
  });

  describe("getById", () => {
    it("should return manufacturer by numeric ID", async () => {
      const testData = createTestManufacturer();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith("manufacturers");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(result?.name).toBe(testData.name);
    });

    it("should return null when manufacturer not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe("getByUuid", () => {
    it("should return manufacturer by UUID", async () => {
      const testData = createTestManufacturer();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "manufacturers.uuid",
        testData.uuid,
      );
      expect(result?.name).toBe(testData.name);
    });

    it("should return null when manufacturer not found by UUID", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("getIdByUuid", () => {
    it("should return internal numeric ID for a given UUID", async () => {
      const testData = createTestManufacturer();
      mockQueryBuilder.first.mockResolvedValue({ id: testData.id });

      const result = await dao.getIdByUuid(testData.uuid);

      expect(mockQueryBuilder.select).toHaveBeenCalledWith("manufacturers.id");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "manufacturers.uuid",
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
    it("should update manufacturer by numeric ID", async () => {
      const testData = createTestManufacturer();
      const updatedData = {
        ...testData,
        code: "UPDATED",
        name: "Updated Manufacturer",
      };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        code: "UPDATED",
        name: "Updated Manufacturer",
      });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UPDATED",
          name: "Updated Manufacturer",
        }),
      );
      expect(result?.name).toBe("Updated Manufacturer");
    });

    it("should only update provided fields", async () => {
      const testData = createTestManufacturer();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { name: "New Name" });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall).toHaveProperty("name", "New Name");
      expect(updateCall).not.toHaveProperty("code");
    });

    it("should return null when updating non-existent manufacturer", async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { name: "Updated" });

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete manufacturer by numeric ID and return true", async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith("manufacturers");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", 1);
      expect(result).toBe(true);
    });

    it("should return false when manufacturer not found", async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return paginated manufacturers", async () => {
      const testData = [
        createTestManufacturer({ id: 1, code: "MFG001" }),
        createTestManufacturer({ id: 2, code: "MFG002" }),
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
      mockQueryBuilder.offset.mockResolvedValue([createTestManufacturer()]);
      mockQueryBuilder.first.mockResolvedValue({ count: "25" });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });
  });
});
