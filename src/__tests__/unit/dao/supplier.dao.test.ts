// @ts-nocheck
/**
 * SupplierDAO Unit Tests
 * Tests for the Supplier data access layer with supply type flags
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createTestSupplier,
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
import { SupplierDAO } from '../../../dao/supplier/supplier.dao';

describe('SupplierDAO', () => {
  let dao: SupplierDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = { now: jest.fn().mockReturnValue(new Date().toISOString()) };

    dao = new SupplierDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a new supplier and return it', async () => {
      const testData = createTestSupplier();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        code: testData.code,
        suppliesSheets: testData.suppliesSheets,
        suppliesElaborated: testData.suppliesElaborated,
        suppliesConsumables: testData.suppliesConsumables,
        suppliesPaper: testData.suppliesPaper,
        suppliesTooling: testData.suppliesTooling,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith('suppliers');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: testData.uuid,
          code: testData.code,
        })
      );
      expect(result.code).toBe(testData.code);
    });

    it('should set default values for supply type flags', async () => {
      const testData = createTestSupplier();
      mockQueryBuilder.returning.mockResolvedValue([{
        ...testData,
        suppliesSheets: false,
        suppliesElaborated: false,
        suppliesConsumables: false,
        suppliesPaper: false,
        suppliesTooling: false,
      }]);

      await dao.create({
        uuid: testData.uuid,
        code: testData.code,
      } as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          suppliesSheets: false,
          suppliesElaborated: false,
          suppliesConsumables: false,
          suppliesPaper: false,
          suppliesTooling: false,
        })
      );
    });
  });

  describe('getById', () => {
    it('should return supplier by numeric ID', async () => {
      const testData = createTestSupplier();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith('suppliers');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(result?.code).toBe(testData.code);
    });

    it('should return null when supplier not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('getByUuid', () => {
    it('should return supplier by UUID', async () => {
      const testData = createTestSupplier();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('uuid', testData.uuid);
      expect(result?.code).toBe(testData.code);
    });

    it('should return null when supplier not found by UUID', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('getIdByUuid', () => {
    it('should return internal numeric ID for a given UUID', async () => {
      const testData = createTestSupplier();
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
    it('should update supplier by numeric ID', async () => {
      const testData = createTestSupplier();
      const updatedData = { ...testData, code: 'UPDATED', suppliesPaper: true };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        code: 'UPDATED',
        suppliesPaper: true,
      });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UPDATED',
          suppliesPaper: true,
        })
      );
      expect(result?.code).toBe('UPDATED');
    });

    it('should update individual supply type flags', async () => {
      const testData = createTestSupplier();
      mockQueryBuilder.returning.mockResolvedValue([{ ...testData, suppliesSheets: true }]);

      await dao.update(testData.id, { suppliesSheets: true });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock.calls[0][0];
      expect(updateCall).toHaveProperty('suppliesSheets', true);
    });

    it('should only update provided fields', async () => {
      const testData = createTestSupplier();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { code: 'NEW_CODE' });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock.calls[0][0];
      expect(updateCall).toHaveProperty('code', 'NEW_CODE');
      expect(updateCall).not.toHaveProperty('suppliesSheets');
    });

    it('should return null when updating non-existent supplier', async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { code: 'UPDATED' });

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete supplier by numeric ID and return true', async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith('suppliers');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', 1);
      expect(result).toBe(true);
    });

    it('should return false when supplier not found', async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return paginated suppliers', async () => {
      const testData = [
        createTestSupplier({ id: 1, code: 'SPL001' }),
        createTestSupplier({ id: 2, code: 'SPL002' }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: '2' });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should order by code ascending', async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('code', 'asc');
    });

    it('should calculate correct pagination', async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestSupplier()]);
      mockQueryBuilder.first.mockResolvedValue({ count: '25' });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });
  });

  describe('Supply type flags', () => {
    it('should handle all supply type flags as true', async () => {
      const testData = createTestSupplier({
        suppliesSheets: true,
        suppliesElaborated: true,
        suppliesConsumables: true,
        suppliesPaper: true,
        suppliesTooling: true,
      });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.suppliesSheets).toBe(true);
      expect(result?.suppliesElaborated).toBe(true);
      expect(result?.suppliesConsumables).toBe(true);
      expect(result?.suppliesPaper).toBe(true);
      expect(result?.suppliesTooling).toBe(true);
    });

    it('should default missing flags to false', async () => {
      const testData = {
        id: 1,
        uuid: 'test-uuid',
        code: 'SPL001',
        // Missing supply type flags - should default to false
      };
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(1);

      expect(result?.suppliesSheets).toBe(false);
      expect(result?.suppliesElaborated).toBe(false);
      expect(result?.suppliesConsumables).toBe(false);
      expect(result?.suppliesPaper).toBe(false);
      expect(result?.suppliesTooling).toBe(false);
    });
  });
});
