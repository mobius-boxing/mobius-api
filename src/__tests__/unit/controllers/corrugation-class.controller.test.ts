// @ts-nocheck
/**
 * CorrugationClassController Unit Tests
 * Tests for the Corrugation Class API controller
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createPaginatedRequest,
  createUuidParamRequest,
  createBodyRequest,
} from '../../mocks/express.mock';
import {
  createTestCorrugationClass,
  createTestCorrugationClassResponse,
  createPaginatedResponse,
  resetIdCounter,
} from '../../mocks/factories';

// Store reference to mock functions in a container
const mockFunctions = {
  getAll: jest.fn(),
  getAllWithFilters: jest.fn(),
  getByUuid: jest.fn(),
  getIdByUuid: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// Mock uuid module
jest.mock('uuid', () => ({
  v4: () => 'generated-uuid',
}));

// Mock the DAO module
jest.mock('../../../dao/corrugation-class/corrugation-class.dao', () => {
  const { mockFunctions: mf } = require('./corrugation-class.controller.test');
  return {
    CorrugationClassDAO: function() {
      return {
        getAll: (...args) => mf.getAll(...args),
        getAllWithFilters: (...args) => mf.getAllWithFilters(...args),
        getByUuid: (...args) => mf.getByUuid(...args),
        getIdByUuid: (...args) => mf.getIdByUuid(...args),
        create: (...args) => mf.create(...args),
        update: (...args) => mf.update(...args),
        delete: (...args) => mf.delete(...args),
      };
    },
  };
});

// Track validation mock behavior
let validationMockBehavior = { success: true, message: '' };

// Mock the @sundaysf/utils module
jest.mock('@sundaysf/utils', () => ({
  paginationHelper: (req: any) => ({
    page: req.query?.page ? parseInt(req.query.page) : 1,
    limit: req.query?.limit ? parseInt(req.query.limit) : 10,
  }),
  inputValidator: async (dto: any) => {
    // Use the closure variable to control behavior
    const { mockFunctions: mf } = require('./corrugation-class.controller.test');
    if (!dto.code || dto.code.trim() === '') {
      return { success: false, message: 'Code is required' };
    }
    return { success: true, message: '' };
  },
}));

// Export mock functions for access in the mock
export { mockFunctions };

// Company injection (base-crud) resolves the caller's company via the
// shared foreignKeyResolver — stub it so create paths get companyId 1.
jest.mock('../../../utils/foreignKeyResolver', () => ({
  ...jest.requireActual('../../../utils/foreignKeyResolver'),
  getIdByUuid: jest.fn().mockResolvedValue(1),
}));

// Import controller after mocking
import { CorrugationClassController } from '../../../controllers/corrugation-class/corrugation-class.controller';

describe('CorrugationClassController', () => {
  let controller: CorrugationClassController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();

    // Reset all mock functions
    mockFunctions.getAll.mockReset();
    mockFunctions.getAllWithFilters.mockReset();
    mockFunctions.getByUuid.mockReset();
    mockFunctions.getIdByUuid.mockReset();
    mockFunctions.create.mockReset();
    mockFunctions.update.mockReset();
    mockFunctions.delete.mockReset();

    // Create controller instance
    controller = new CorrugationClassController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return paginated corrugation classes', async () => {
      const testData = [
        createTestCorrugationClassResponse({ code: 'CC001' }),
        createTestCorrugationClassResponse({ code: 'CC002' }),
      ];
      const paginatedResult = createPaginatedResponse(testData, 1, 10, 2);

      mockFunctions.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = createPaginatedRequest(1, 10) as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getAllWithFilters).toHaveBeenCalledWith(mockReq);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(paginatedResult);
    });

    it('should use default pagination when not provided', async () => {
      const paginatedResult = createPaginatedResponse([], 1, 10, 0);
      mockFunctions.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = createMockRequest() as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getAllWithFilters).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockFunctions.getAllWithFilters.mockRejectedValue(error);

      const mockReq = createPaginatedRequest() as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getByUuid', () => {
    it('should return corrugation class when found', async () => {
      const testData = createTestCorrugationClassResponse();
      mockFunctions.getByUuid.mockResolvedValue(testData);

      const mockReq = createUuidParamRequest(testData.uuid) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getByUuid).toHaveBeenCalledWith(testData.uuid, undefined);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: testData,
      });
    });

    it('should return 404 when corrugation class not found', async () => {
      mockFunctions.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation class not found',
      });
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockFunctions.getByUuid.mockRejectedValue(error);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('create', () => {
    it('should create corrugation class with valid input', async () => {
      const inputData = { code: 'NEW001', description: 'New Class' };
      const createdData = createTestCorrugationClassResponse({
        uuid: 'generated-uuid',
        code: 'NEW001',
        description: 'New Class',
      });
      mockFunctions.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData, { user: { role: 'admin', companyId: 'company-uuid' } } as any) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'generated-uuid',
          code: 'NEW001',
          description: 'New Class',
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: createdData,
      });
    });

    it('should generate UUID server-side', async () => {
      const inputData = { code: 'NEW001', description: 'New Class' };
      mockFunctions.create.mockResolvedValue(createTestCorrugationClassResponse());

      const mockReq = createBodyRequest(inputData, { user: { role: 'admin', companyId: 'company-uuid' } } as any) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'generated-uuid',
        })
      );
    });

    it('should call next with error on validation failure', async () => {
      // Empty code should fail validation
      const invalidData = { code: '', description: 'Test' };
      const mockReq = createBodyRequest(invalidData, { user: { role: 'admin', companyId: 'company-uuid' } } as any) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      // Validation error should call next with an Error
      expect(mockNext).toHaveBeenCalled();
      const calledWith = (mockNext as jest.Mock).mock.calls[0][0];
      expect(calledWith).toBeInstanceOf(Error);
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockFunctions.create.mockRejectedValue(error);

      const mockReq = createBodyRequest(
        { code: 'NEW001' },
        { user: { role: 'admin', companyId: 'company-uuid' } } as any,
      ) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('update', () => {
    it('should update corrugation class when found', async () => {
      const existingId = 1;
      const testUuid = 'existing-uuid';
      const updateData = { code: 'UPDATED', description: 'Updated description' };
      const updatedData = createTestCorrugationClassResponse({
        uuid: testUuid,
        code: 'UPDATED',
        description: 'Updated description',
      });

      mockFunctions.getIdByUuid.mockResolvedValue(existingId);
      mockFunctions.update.mockResolvedValue(updatedData);

      const mockReq = {
        ...createUuidParamRequest(testUuid),
        body: updateData,
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getIdByUuid).toHaveBeenCalledWith(testUuid, undefined);
      expect(mockFunctions.update).toHaveBeenCalledWith(existingId, expect.any(Object));
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: updatedData,
      });
    });

    it('should return 404 when corrugation class not found for update', async () => {
      mockFunctions.getIdByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest('non-existent-uuid'),
        body: { code: 'UPDATED' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation class not found',
      });
      expect(mockFunctions.update).not.toHaveBeenCalled();
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockFunctions.getIdByUuid.mockResolvedValue(1);
      mockFunctions.update.mockRejectedValue(error);

      const mockReq = {
        ...createUuidParamRequest('test-uuid'),
        body: { code: 'UPDATED' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('delete', () => {
    it('should delete corrugation class when found', async () => {
      const existingId = 1;
      const testUuid = 'existing-uuid';

      mockFunctions.getIdByUuid.mockResolvedValue(existingId);
      mockFunctions.delete.mockResolvedValue(true);

      const mockReq = createUuidParamRequest(testUuid) as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getIdByUuid).toHaveBeenCalledWith(testUuid, undefined);
      expect(mockFunctions.delete).toHaveBeenCalledWith(existingId);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Corrugation class deleted successfully',
      });
    });

    it('should return 404 when corrugation class not found for delete', async () => {
      mockFunctions.getIdByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation class not found',
      });
      expect(mockFunctions.delete).not.toHaveBeenCalled();
    });

    it('should return 404 when delete operation fails', async () => {
      mockFunctions.getIdByUuid.mockResolvedValue(1);
      mockFunctions.delete.mockResolvedValue(false);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to delete corrugation class',
      });
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockFunctions.getIdByUuid.mockResolvedValue(1);
      mockFunctions.delete.mockRejectedValue(error);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('Security: UUID-only operations', () => {
    it('should only use UUID for external identification', async () => {
      const testData = createTestCorrugationClassResponse();
      mockFunctions.getByUuid.mockResolvedValue(testData);

      const mockReq = createUuidParamRequest(testData.uuid) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      // Verify response does not contain numeric ID
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.not.objectContaining({ id: expect.any(Number) }),
      });
    });

    it('should convert UUID to internal ID for update operations', async () => {
      const testUuid = 'test-uuid';
      const internalId = 42;

      mockFunctions.getIdByUuid.mockResolvedValue(internalId);
      mockFunctions.update.mockResolvedValue(createTestCorrugationClassResponse());

      const mockReq = {
        ...createUuidParamRequest(testUuid),
        body: { code: 'UPDATED' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getIdByUuid).toHaveBeenCalledWith(testUuid, undefined);
      expect(mockFunctions.update).toHaveBeenCalledWith(internalId, expect.any(Object));
    });

    it('should convert UUID to internal ID for delete operations', async () => {
      const testUuid = 'test-uuid';
      const internalId = 42;

      mockFunctions.getIdByUuid.mockResolvedValue(internalId);
      mockFunctions.delete.mockResolvedValue(true);

      const mockReq = createUuidParamRequest(testUuid) as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockFunctions.getIdByUuid).toHaveBeenCalledWith(testUuid, undefined);
      expect(mockFunctions.delete).toHaveBeenCalledWith(internalId);
    });
  });
});
