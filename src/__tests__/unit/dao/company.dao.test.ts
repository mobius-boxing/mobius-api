// @ts-nocheck
/**
 * CompanyDAO Unit Tests
 * Tests for the Company data access layer
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTestCompany, resetIdCounter } from "../../mocks/factories";
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
import { CompanyDAO } from "../../../dao/company/company.dao";

describe("CompanyDAO", () => {
  let dao: CompanyDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = {
      now: jest.fn().mockReturnValue(new Date().toISOString()),
    };
    (mockKnex as any).raw = jest.fn().mockReturnValue("");

    dao = new CompanyDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("create", () => {
    it("should create a new company and return it", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        name: testData.name,
        description: testData.description,
        isActive: testData.isActive,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith("companies");
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: testData.name,
          description: testData.description,
          isActive: testData.isActive,
        }),
      );
      expect(mockQueryBuilder.returning).toHaveBeenCalledWith("*");
      expect(result.name).toBe(testData.name);
      expect(result.uuid).toBe(testData.uuid);
    });

    it("should set default value for isActive to true", async () => {
      const testData = createTestCompany({ isActive: undefined });
      mockQueryBuilder.returning.mockResolvedValue([
        { ...testData, isActive: true },
      ]);

      await dao.create({
        name: testData.name,
        description: testData.description,
      } as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
        }),
      );
    });
  });

  describe("getById", () => {
    it("should return company by numeric ID", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith("companies");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.first).toHaveBeenCalled();
      expect(result?.name).toBe(testData.name);
      expect(result?.uuid).toBe(testData.uuid);
    });

    it("should return null when company not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe("getByUuid", () => {
    it("should return company by UUID", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith("companies");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "uuid",
        testData.uuid,
      );
      expect(result?.name).toBe(testData.name);
    });

    it("should return null when company not found by UUID", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("getIdByUuid", () => {
    it("should return internal numeric ID for a given UUID", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.first.mockResolvedValue({ id: testData.id });

      const result = await dao.getIdByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith("companies");
      expect(mockQueryBuilder.select).toHaveBeenCalledWith("id");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "uuid",
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
    it("should update company by numeric ID", async () => {
      const testData = createTestCompany();
      const updatedData = {
        ...testData,
        name: "Updated Company",
        description: "Updated description",
      };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        name: "Updated Company",
        description: "Updated description",
      });

      expect(mockKnex).toHaveBeenCalledWith("companies");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated Company",
          description: "Updated description",
        }),
      );
      expect(result?.name).toBe("Updated Company");
    });

    it("should only update provided fields", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { name: "New Name" });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall).toHaveProperty("name", "New Name");
      expect(updateCall).not.toHaveProperty("description");
    });

    it("should return null when updating non-existent company", async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { name: "Updated" });

      expect(result).toBeNull();
    });

    it("should update isActive status", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.returning.mockResolvedValue([
        { ...testData, isActive: false },
      ]);

      await dao.update(testData.id, { isActive: false });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe("delete", () => {
    it("should delete company by numeric ID and return true", async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith("companies");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", 1);
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when company not found", async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return paginated companies", async () => {
      const testData = [
        createTestCompany({ id: 1, name: "Company A" }),
        createTestCompany({ id: 2, name: "Company B" }),
        createTestCompany({ id: 3, name: "Company C" }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: "3" });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(3);
      expect(result.totalPages).toBe(1);
    });

    it("should order by createdAt descending", async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "createdAt",
        "desc",
      );
    });

    it("should calculate correct pagination", async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestCompany()]);
      mockQueryBuilder.first.mockResolvedValue({ count: "25" });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });

    it("should calculate offset correctly", async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(3, 20);

      // Offset should be (page - 1) * limit = (3 - 1) * 20 = 40
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(40);
    });
  });

  describe("getCompanyWithUserCount", () => {
    it("should return company with user count", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.first.mockResolvedValue({ ...testData, user_count: 5 });

      const result = await dao.getCompanyWithUserCount(testData.uuid);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        "users",
        "companies.id",
        "users.companyId",
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith("companies.id");
      expect(result?.uuid).toBe(testData.uuid);
      expect(result?.userCount).toBe(5);
    });

    it("should return null when company not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getCompanyWithUserCount("non-existent-uuid");

      expect(result).toBeNull();
    });

    it("should return user count of 0 for company with no users", async () => {
      const testData = createTestCompany();
      mockQueryBuilder.first.mockResolvedValue({ ...testData, user_count: 0 });

      const result = await dao.getCompanyWithUserCount(testData.uuid);

      expect(result?.userCount).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty company name", async () => {
      const testData = createTestCompany({ name: "" });
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        name: "",
        description: testData.description,
      } as any);

      expect(result.name).toBe("");
    });

    it("should handle null description", async () => {
      const testData = createTestCompany({ description: null });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.description).toBeNull();
    });
  });
});
