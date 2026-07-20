// @ts-nocheck
/**
 * CustomerDAO Unit Tests
 * Tests for the Customer data access layer with JSON fields and company filtering
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createTestCustomer,
  createTestCompany,
  createTestCustomerCategory,
  createTestUser,
  resetIdCounter,
} from '../../mocks/factories';
import { createMockQueryBuilder, MockQueryBuilder } from '../../mocks/knex.mock';

// We need to create fresh mocks that persist across beforeEach
let mockQueryBuilder: any;
let mockKnex: jest.Mock<any>;

jest.mock('../../../database/KnexConnection', () => ({
  __esModule: true,
  default: {
    getConnection: () => mockKnex,
  },
}));

// Import DAO after mocking
import { CustomerDAO } from '../../../dao/customer/customer.dao';

describe('CustomerDAO', () => {
  let dao: CustomerDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = { now: jest.fn().mockReturnValue(new Date().toISOString()) };
    (mockKnex as any).raw = jest.fn().mockReturnValue('');

    dao = new CustomerDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a new customer and return it', async () => {
      const testData = createTestCustomer();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        companyId: testData.companyId,
        name: testData.name,
        supplierCode: testData.supplierCode,
        active: testData.active,
        legalName: testData.legalName,
        legalCode: testData.legalCode,
        address: testData.address,
        tradeName: testData.tradeName,
        contacts: testData.contacts,
        deliveryLocations: testData.deliveryLocations,
        deliveryDays: testData.deliveryDays,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith('customers');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: testData.uuid,
          name: testData.name,
          companyId: testData.companyId,
        })
      );
      expect(result.name).toBe(testData.name);
      expect(result.uuid).toBe(testData.uuid);
    });

    it('should stringify JSON fields on insert', async () => {
      // deliveryLocations/deliveryDays moved to real tables (20260720000008);
      // contacts is the only remaining JSON column.
      const contacts = [{ name: 'John', email: 'john@test.com' }];

      const testData = createTestCustomer({ contacts });
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.create({
        uuid: testData.uuid,
        companyId: testData.companyId,
        name: testData.name,
        contacts,
      } as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          contacts: JSON.stringify(contacts),
        })
      );
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.not.objectContaining({
          deliveryLocations: expect.anything(),
        })
      );
    });

    it('should set default value for active to true', async () => {
      const testData = createTestCustomer({ active: undefined });
      mockQueryBuilder.returning.mockResolvedValue([{ ...testData, active: true }]);

      await dao.create({
        uuid: testData.uuid,
        companyId: testData.companyId,
        name: testData.name,
      } as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          active: true,
        })
      );
    });
  });

  describe('getById', () => {
    it('should return customer by numeric ID', async () => {
      const testData = createTestCustomer();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith('customers');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(result?.name).toBe(testData.name);
    });

    it('should return null when customer not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('getByUuid', () => {
    it('should return customer by UUID', async () => {
      const testData = createTestCustomer();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('customers.uuid', testData.uuid);
      expect(result?.name).toBe(testData.name);
    });

    it('should filter by company UUID when provided', async () => {
      const company = createTestCompany();
      const testData = createTestCustomer({ companyId: company.id });
      mockQueryBuilder.first.mockResolvedValue(testData);

      await dao.getByUuid(testData.uuid, company.uuid);

      expect(mockQueryBuilder.join).toHaveBeenCalledWith(
        'companies',
        'customers.companyId',
        'companies.id'
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('companies.uuid', company.uuid);
    });

    it('should return null when customer not found by UUID', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('getIdByUuid', () => {
    it('should return internal numeric ID for a given UUID', async () => {
      const testData = createTestCustomer();
      mockQueryBuilder.first.mockResolvedValue({ id: testData.id });

      const result = await dao.getIdByUuid(testData.uuid);

      expect(mockQueryBuilder.select).toHaveBeenCalledWith('id');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('uuid', testData.uuid);
      expect(result).toBe(testData.id);
    });

    it('should return null when UUID not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getIdByUuid('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update customer by numeric ID', async () => {
      const testData = createTestCustomer();
      const updatedData = { ...testData, name: 'Updated Customer' };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, { name: 'Updated Customer' });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Customer' })
      );
      expect(result?.name).toBe('Updated Customer');
    });

    it('should stringify JSON fields on update', async () => {
      const testData = createTestCustomer();
      const newContacts = [{ name: 'Jane', phone: '555-1234' }];
      mockQueryBuilder.returning.mockResolvedValue([{ ...testData, contacts: newContacts }]);

      await dao.update(testData.id, { contacts: newContacts });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          contacts: JSON.stringify(newContacts),
        })
      );
    });

    it('should only update provided fields', async () => {
      const testData = createTestCustomer();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { name: 'New Name' });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock.calls[0][0];
      expect(updateCall).toHaveProperty('name', 'New Name');
      expect(updateCall).not.toHaveProperty('address');
      expect(updateCall).not.toHaveProperty('supplierCode');
    });

    it('should return null when updating non-existent customer', async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { name: 'Updated' });

      expect(result).toBeNull();
    });

    it('should update active status', async () => {
      const testData = createTestCustomer();
      mockQueryBuilder.returning.mockResolvedValue([{ ...testData, active: false }]);

      await dao.update(testData.id, { active: false });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ active: false })
      );
    });
  });

  describe('delete', () => {
    it('should delete customer by numeric ID and return true', async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith('customers');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', 1);
      expect(result).toBe(true);
    });

    it('should return false when customer not found', async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return paginated customers', async () => {
      const testData = [
        createTestCustomer({ id: 1, name: 'Customer A' }),
        createTestCustomer({ id: 2, name: 'Customer B' }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: '2' });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should filter by company UUID when provided', async () => {
      const company = createTestCompany();
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10, company.uuid);

      expect(mockQueryBuilder.join).toHaveBeenCalledWith(
        'companies',
        'customers.companyId',
        'companies.id'
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('companies.uuid', company.uuid);
    });

    it('should order by createdAt descending', async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('customers.createdAt', 'desc');
    });

    it('should calculate correct pagination', async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestCustomer()]);
      mockQueryBuilder.first.mockResolvedValue({ count: '50' });

      const result = await dao.getAll(3, 15);

      expect(result.page).toBe(3);
      expect(result.limit).toBe(15);
      expect(result.totalCount).toBe(50);
      expect(result.totalPages).toBe(4);
    });
  });

  describe('getCustomerWithDetails', () => {
    it('should return customer with related company, category, and sales person', async () => {
      const company = createTestCompany();
      const category = createTestCustomerCategory();
      const salesPerson = createTestUser();
      const testData = createTestCustomer({
        companyId: company.id,
        categoryId: category.id,
        salesPersonId: salesPerson.id,
        company,
        category,
        sales_person: salesPerson,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getCustomerWithDetails(testData.uuid);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledTimes(3);
      expect(result?.uuid).toBe(testData.uuid);
    });

    it('should filter by company UUID when provided', async () => {
      const company = createTestCompany();
      const testData = createTestCustomer();
      mockQueryBuilder.first.mockResolvedValue(testData);

      await dao.getCustomerWithDetails(testData.uuid, company.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('companies.uuid', company.uuid);
    });

    it('should return null when customer not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getCustomerWithDetails('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('JSON field parsing', () => {
    it('should parse JSON string fields from database', async () => {
      const contacts = [{ name: 'Contact 1' }];

      const testData = createTestCustomer({
        contacts: JSON.stringify(contacts),
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(Array.isArray(result?.contacts)).toBe(true);
    });

    it('should handle already parsed JSON fields', async () => {
      const contacts = [{ name: 'Contact 1' }];
      const testData = createTestCustomer({ contacts });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(Array.isArray(result?.contacts)).toBe(true);
    });

    it('should handle null JSON fields', async () => {
      const testData = createTestCustomer({
        contacts: null,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.contacts).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('should handle customer with no optional fields', async () => {
      const testData = createTestCustomer({
        salesPersonId: null,
        categoryId: null,
        legalName: null,
        legalCode: null,
        address: null,
        tradeName: null,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.salesPersonId).toBeNull();
      expect(result?.categoryId).toBeNull();
    });

    it('should handle supplier code mapping (snake_case to camelCase)', async () => {
      const testData = {
        ...createTestCustomer(),
        supplier_code: 'SUP001',
      };

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.supplierCode).toBe('SUP001');
    });
  });
});
