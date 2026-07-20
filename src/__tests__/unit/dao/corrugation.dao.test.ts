// @ts-nocheck
/**
 * CorrugationDAO Unit Tests
 * Tests for the Corrugation data access layer with foreign key handling
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createTestCorrugation,
  createTestCorrugationClass,
  resetIdCounter,
} from '../../mocks/factories';
import { createMockQueryBuilder } from '../../mocks/knex.mock';

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
import { CorrugationDAO } from '../../../dao/corrugation/corrugation.dao';

describe('CorrugationDAO', () => {
  let dao: CorrugationDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();

    // The DAO now loads/writes the corrugation_layers child table: reads await
    // the builder directly (needs a real thenable) and writes go through
    // knex.transaction(cb). Route the layers table to its own resolving
    // builder; everything else keeps the shared chainable mock.
    const layersQueryBuilder: any = createMockQueryBuilder();
    layersQueryBuilder.insert = jest.fn().mockResolvedValue([]);
    layersQueryBuilder.delete = jest.fn().mockResolvedValue(0);
    layersQueryBuilder.then = jest.fn((resolve: any, reject: any) =>
      Promise.resolve([]).then(resolve, reject)
    );

    mockKnex = jest.fn((table: string) =>
      typeof table === 'string' && table.startsWith('corrugation_layers')
        ? layersQueryBuilder
        : mockQueryBuilder
    );
    (mockKnex as any).fn = { now: jest.fn().mockReturnValue(new Date().toISOString()) };
    (mockKnex as any).raw = jest.fn().mockReturnValue('');
    (mockKnex as any).transaction = jest.fn(async (cb: any) => cb(mockKnex));

    dao = new CorrugationDAO();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new corrugation and return it without numeric IDs', async () => {
      const corrugationClass = createTestCorrugationClass();
      const testData = createTestCorrugation({ corrugationClassId: corrugationClass.id });

      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        code: testData.code,
        description: testData.description,
        theoreticalGrammage: testData.theoreticalGrammage,
        suggestedWidth: testData.suggestedWidth,
        caliper: testData.caliper,
        corrugationClassId: testData.corrugationClassId,
      });

      expect(mockKnex).toHaveBeenCalledWith('corrugations');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: testData.uuid,
          code: testData.code,
          corrugationClassId: testData.corrugationClassId,
        })
      );

      // SECURITY: Verify no numeric IDs in response
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('corrugationClassId');
      expect(result.uuid).toBe(testData.uuid);
    });
  });

  describe('getById', () => {
    it('should return corrugation by numeric ID without exposing IDs', async () => {
      const testData = createTestCorrugation();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith('corrugations');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);

      // SECURITY: Verify no numeric IDs in response
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('corrugationClassId');
      expect(result?.uuid).toBe(testData.uuid);
    });

    it('should return null when corrugation not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('getByUuid', () => {
    it('should return corrugation with related corrugation class (UUID only)', async () => {
      const corrugationClass = createTestCorrugationClass();
      const testData = createTestCorrugation({
        corrugationClassId: corrugationClass.id,
        corrugationClass: corrugationClass,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith('corrugations');
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalled();

      // SECURITY: Verify no numeric IDs in response
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('corrugationClassId');
      expect(result?.uuid).toBe(testData.uuid);

      // Verify related object has UUID but no numeric ID
      if (result?.corrugationClass) {
        expect(result.corrugationClass).not.toHaveProperty('id');
        expect(result.corrugationClass).toHaveProperty('uuid');
      }
    });

    it('should return null when corrugation not found by UUID', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('getIdByUuid', () => {
    it('should return internal numeric ID for a given UUID', async () => {
      const testData = createTestCorrugation();
      mockQueryBuilder.first.mockResolvedValue({ id: testData.id });

      const result = await dao.getIdByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith('corrugations');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('corrugations.id');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('corrugations.uuid', testData.uuid);
      expect(result).toBe(testData.id);
    });

    it('should return null when UUID not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getIdByUuid('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update corrugation by numeric ID', async () => {
      const testData = createTestCorrugation();
      const updatedData = {
        ...testData,
        code: 'UPDATED',
        theoreticalGrammage: 200.0,
      };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        code: 'UPDATED',
        theoreticalGrammage: 200.0,
      });

      expect(mockKnex).toHaveBeenCalledWith('corrugations');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UPDATED',
          theoreticalGrammage: 200.0,
        })
      );

      // SECURITY: Verify no numeric IDs in response
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('corrugationClassId');
    });

    it('should update corrugationClassId when provided', async () => {
      const testData = createTestCorrugation();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { corrugationClassId: 5 });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ corrugationClassId: 5 })
      );
    });

    it('should return null when updating non-existent corrugation', async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { code: 'UPDATED' });

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete corrugation by numeric ID and return true', async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith('corrugations');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', 1);
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when corrugation not found', async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return paginated corrugations with related objects (no numeric IDs)', async () => {
      const corrugationClass = createTestCorrugationClass();
      const testData = [
        createTestCorrugation({
          id: 1,
          code: 'CRG001',
          corrugationClass: corrugationClass,
        }),
        createTestCorrugation({
          id: 2,
          code: 'CRG002',
          corrugationClass: corrugationClass,
        }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: '2' });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);

      // SECURITY: Verify no numeric IDs in response data
      result.data.forEach((item) => {
        expect(item).not.toHaveProperty('id');
        expect(item).not.toHaveProperty('corrugationClassId');
        expect(item).toHaveProperty('uuid');
        expect(item).toHaveProperty('code');

        // Related object should also have no numeric ID
        if (item.corrugationClass) {
          expect(item.corrugationClass).not.toHaveProperty('id');
          expect(item.corrugationClass).toHaveProperty('uuid');
        }
      });
    });

    it('should include left join for corrugation class', async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        'corrugation_classes as cc',
        'corrugations.corrugationClassId',
        'cc.id'
      );
    });

    it('should order by code ascending', async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('corrugations.code', 'asc');
    });
  });

  describe('Security: Foreign Key Handling', () => {
    it('should strip numeric ID from related corrugationClass object', async () => {
      const corrugationClass = createTestCorrugationClass();
      const testData = createTestCorrugation({
        corrugationClass: {
          id: corrugationClass.id, // This should be stripped
          uuid: corrugationClass.uuid,
          code: corrugationClass.code,
          description: corrugationClass.description,
        },
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      // The corrugationClass should have UUID but not ID
      expect(result?.corrugationClass).toBeDefined();
      expect(result?.corrugationClass).not.toHaveProperty('id');
      expect(result?.corrugationClass?.uuid).toBe(corrugationClass.uuid);
    });

    it('should handle null corrugationClass gracefully', async () => {
      const testData = createTestCorrugation({
        corrugationClassId: null,
        corrugationClass: null,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(result?.corrugationClass).toBeUndefined();
    });
  });

  describe('Numeric Field Parsing', () => {
    it('should parse decimal fields correctly', async () => {
      const testData = createTestCorrugation({
        theoreticalGrammage: '150.5', // String from DB
        suggestedWidth: '1200.00',
        caliper: '0.35',
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(typeof result?.theoreticalGrammage).toBe('number');
      expect(typeof result?.suggestedWidth).toBe('number');
      expect(typeof result?.caliper).toBe('number');
      expect(result?.theoreticalGrammage).toBe(150.5);
      expect(result?.suggestedWidth).toBe(1200);
      expect(result?.caliper).toBe(0.35);
    });

    it('should handle null decimal fields', async () => {
      const testData = createTestCorrugation({
        theoreticalGrammage: null,
        suggestedWidth: null,
        caliper: null,
      });

      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.theoreticalGrammage).toBeUndefined();
      expect(result?.suggestedWidth).toBeUndefined();
      expect(result?.caliper).toBeUndefined();
    });
  });
});
