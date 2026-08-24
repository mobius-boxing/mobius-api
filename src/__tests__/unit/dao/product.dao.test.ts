// @ts-nocheck
/**
 * ProductDAO Unit Tests
 * Tests for the Product data access layer
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
  createTestProduct,
  createTestCompany,
  createTestCustomer,
  resetIdCounter,
} from "../../mocks/factories";
import { createMockQueryBuilder } from "../../mocks/knex.mock";

// We need to create fresh mocks that persist across beforeEach
let mockQueryBuilder: any;
let mockKnex: jest.Mock<any>;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

// Import DAO after mocking
import { ProductDAO, PRODUCT_FILTERS } from "../../../dao/product/product.dao";

describe("ProductDAO", () => {
  let dao: ProductDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = {
      now: jest.fn().mockReturnValue(new Date().toISOString()),
    };
    (mockKnex as any).raw = jest.fn().mockReturnValue("");
    (mockKnex as any).transaction = jest.fn(async (cb: any) => cb(mockKnex));
    (mockQueryBuilder as any).pluck = jest.fn().mockResolvedValue([]);
    (mockQueryBuilder as any).whereNotExists = jest.fn(() => mockQueryBuilder);
    (mockQueryBuilder as any).whereRaw = jest.fn(() => mockQueryBuilder);

    dao = new ProductDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("create", () => {
    it("should create a new product and return it", async () => {
      const testData = createTestProduct();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        companyId: testData.companyId,
        code: testData.code,
        clientCode: testData.clientCode,
        description: testData.description,
        customerId: testData.customerId,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith("products");
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: testData.uuid,
          code: testData.code,
          companyId: testData.companyId,
        }),
      );
      expect(result.code).toBe(testData.code);
      expect(result.uuid).toBe(testData.uuid);
    });
  });

  describe("getById", () => {
    it("should return product by numeric ID", async () => {
      const testData = createTestProduct();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith("products");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(result?.code).toBe(testData.code);
    });

    it("should return null when product not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe("getByUuid", () => {
    it("should return product by UUID", async () => {
      const testData = createTestProduct();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "products.uuid",
        testData.uuid,
      );
      expect(result?.code).toBe(testData.code);
    });

    it("should filter by company UUID when provided", async () => {
      const company = createTestCompany();
      const testData = createTestProduct({ companyId: company.id });
      mockQueryBuilder.first.mockResolvedValue(testData);

      await dao.getByUuid(testData.uuid, company.uuid);

      expect(mockQueryBuilder.join).toHaveBeenCalledWith(
        "companies",
        "products.companyId",
        "companies.id",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "companies.uuid",
        company.uuid,
      );
    });

    it("should return null when product not found by UUID", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update product by numeric ID", async () => {
      const testData = createTestProduct();
      const updatedData = {
        ...testData,
        code: "UPDATED_CODE",
        description: "Updated description",
      };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        code: "UPDATED_CODE",
        description: "Updated description",
      });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UPDATED_CODE",
          description: "Updated description",
        }),
      );
      expect(result?.code).toBe("UPDATED_CODE");
    });

    it("should only update provided fields", async () => {
      const testData = createTestProduct();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { code: "NEW_CODE" });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall).toHaveProperty("code", "NEW_CODE");
      expect(updateCall).not.toHaveProperty("description");
      expect(updateCall).not.toHaveProperty("clientCode");
    });

    it("should return null when updating non-existent product", async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { code: "UPDATED" });

      expect(result).toBeNull();
    });

    it("should update customerId when provided", async () => {
      const testData = createTestProduct();
      mockQueryBuilder.returning.mockResolvedValue([
        { ...testData, customerId: 5 },
      ]);

      await dao.update(testData.id, { customerId: 5 });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 5 }),
      );
    });
  });

  describe("delete", () => {
    it("should delete product by numeric ID and return true", async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith("products");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", 1);
      expect(result).toBe(true);
    });

    it("should return false when product not found", async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return paginated products", async () => {
      const testData = [
        createTestProduct({ id: 1, code: "PROD001" }),
        createTestProduct({ id: 2, code: "PROD002" }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: "2" });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it("should filter by company UUID when provided", async () => {
      const company = createTestCompany();
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(1, 10, company.uuid);

      expect(mockQueryBuilder.join).toHaveBeenCalledWith(
        "companies",
        "products.companyId",
        "companies.id",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "companies.uuid",
        company.uuid,
      );
    });

    it("should order by createdAt descending", async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "products.createdAt",
        "desc",
      );
    });

    it("should calculate correct pagination", async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestProduct()]);
      mockQueryBuilder.first.mockResolvedValue({ count: "50" });

      const result = await dao.getAll(3, 15);

      expect(result.page).toBe(3);
      expect(result.limit).toBe(15);
      expect(result.totalCount).toBe(50);
      expect(result.totalPages).toBe(4);
    });
  });

  describe("getWithDetails", () => {
    it("should return product with customer details", async () => {
      const customer = createTestCustomer();
      const testData = createTestProduct({
        customerId: customer.id,
        customer,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getWithDetails(testData.uuid);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        "customers",
        "products.customerId",
        "customers.id",
      );
      expect(result?.uuid).toBe(testData.uuid);
    });

    it("should filter by company UUID when provided", async () => {
      const company = createTestCompany();
      const testData = createTestProduct();
      mockQueryBuilder.first.mockResolvedValue(testData);

      await dao.getWithDetails(testData.uuid, company.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "companies.uuid",
        company.uuid,
      );
    });

    it("should return null when product not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getWithDetails("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  /**
   * AC-20 / AC-28 — the customer filter is `customerUuid`.
   *
   * The old numeric `customerId` filter was deleted (gate decision OQ-1): under
   * the uuid-only API the client only ever holds a UUID, and `parseInt` turned
   * that into NaN — accepted and broken, which L-007 forbids. It is gone from
   * PRODUCT_FILTERS, so a `?customerId=` query is now an unknown key that the
   * shared builder silently drops (queryBuilder.ts:66) instead of filtering.
   */
  describe("customerUuid filter (AC-20, AC-28)", () => {
    beforeEach(() => {
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });
      mockQueryBuilder.then = (resolve: any) =>
        Promise.resolve([]).then(resolve);
    });

    it("no longer exposes a numeric customerId filter", () => {
      expect(PRODUCT_FILTERS).not.toHaveProperty("customerId");
      expect(PRODUCT_FILTERS).toHaveProperty("uuid");
    });

    it("resolves customerUuid to the numeric column", async () => {
      const customer = createTestCustomer();
      mockQueryBuilder.first
        .mockResolvedValueOnce({ id: customer.id })
        .mockResolvedValue({ count: "0" });

      await dao.getAllWithFilters({
        query: { customerUuid: customer.uuid },
      } as any);

      expect(mockKnex).toHaveBeenCalledWith("customers");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("uuid", customer.uuid);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "products.customerId",
        customer.id,
      );
    });

    it("pins an unknown customerUuid to the impossible id -1", async () => {
      mockQueryBuilder.first
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ count: "0" });

      await dao.getAllWithFilters({
        query: { customerUuid: "99999999-9999-4999-8999-999999999999" },
      } as any);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "products.customerId",
        -1,
      );
    });

    it("rejects a malformed customerUuid before it reaches Postgres", async () => {
      // `customers.uuid` is a uuid column: handing it a non-uuid raises 22P02
      // deep in the driver, which surfaces as a 500 whose body can echo the
      // generated SQL. `name = "ValidationError"` is what makes the error
      // middleware answer 400 instead.
      await expect(
        dao.getAllWithFilters({
          query: { customerUuid: "not-a-uuid" },
        } as any),
      ).rejects.toMatchObject({ name: "ValidationError" });

      expect(mockKnex).not.toHaveBeenCalledWith("customers");
    });

    it("does not filter at all when no customerUuid is supplied", async () => {
      await dao.getAllWithFilters({ query: {} } as any);

      const customerFilterCalls = (
        mockQueryBuilder.where as jest.Mock
      ).mock.calls.filter((call: any[]) => call[0] === "products.customerId");
      expect(customerFilterCalls).toHaveLength(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle product with null customerId", async () => {
      const testData = createTestProduct({ customerId: null });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      // The mapper omits numeric FK ids from the public surface when null
      // (uuid-only API); undefined is the mapped value for a null customerId.
      expect(result?.customerId).toBeUndefined();
    });

    it("should handle empty code", async () => {
      const testData = createTestProduct({ code: "" });
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create(testData as any);

      expect(result.code).toBe("");
    });
  });
});
