// @ts-nocheck
/**
 * CorrugationController Unit Tests
 * Tests for the Corrugation API controller
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
  createTestCorrugation,
  createTestCorrugationResponse,
  createPaginatedResponse,
  resetIdCounter,
} from '../../mocks/factories';

// Store reference to mock functions for CorrugationDAO
const mockCorrugationDAO = {
  getAll: jest.fn(),
  getAllWithFilters: jest.fn(),
  getByUuid: jest.fn(),
  getIdByUuid: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// Store reference to mock functions for CorrugationClassDAO
const mockCorrugationClassDAO = {
  getIdByUuid: jest.fn(),
};

// Mock uuid module
jest.mock('uuid', () => ({
  v4: () => 'generated-uuid',
}));

// Mock the CorrugationDAO module
jest.mock('../../../dao/corrugation/corrugation.dao', () => {
  const { mockCorrugationDAO: mf } = require('./corrugation.controller.test');
  return {
    CorrugationDAO: function() {
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

// Mock the CorrugationClassDAO module
jest.mock('../../../dao/corrugation-class/corrugation-class.dao', () => {
  const { mockCorrugationClassDAO: mf } = require('./corrugation.controller.test');
  return {
    CorrugationClassDAO: function() {
      return {
        getIdByUuid: (...args) => mf.getIdByUuid(...args),
      };
    },
  };
});

// Mock the @sundaysf/utils module
jest.mock('@sundaysf/utils', () => ({
  paginationHelper: (req: any) => ({
    page: req.query?.page ? parseInt(req.query.page) : 1,
    limit: req.query?.limit ? parseInt(req.query.limit) : 10,
  }),
  inputValidator: async (dto: any) => {
    if (!dto.code || dto.code.trim() === '') {
      return { success: false, message: 'Code is required' };
    }
    return { success: true, message: '' };
  },
}));

// Export mock functions for access in the mock
export { mockCorrugationDAO, mockCorrugationClassDAO };

// Import controller after mocking
import { CorrugationController } from '../../../controllers/corrugation/corrugation.controller';

describe('CorrugationController', () => {
  let controller: CorrugationController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();

    // Reset all mock functions
    mockCorrugationDAO.getAll.mockReset();
    mockCorrugationDAO.getAllWithFilters.mockReset();
    mockCorrugationDAO.getByUuid.mockReset();
    mockCorrugationDAO.getIdByUuid.mockReset();
    mockCorrugationDAO.create.mockReset();
    mockCorrugationDAO.update.mockReset();
    mockCorrugationDAO.delete.mockReset();
    mockCorrugationClassDAO.getIdByUuid.mockReset();

    // Create controller instance
    controller = new CorrugationController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return paginated corrugations', async () => {
      const testData = [
        createTestCorrugationResponse({ code: 'C001' }),
        createTestCorrugationResponse({ code: 'C002' }),
      ];
      const paginatedResult = createPaginatedResponse(testData, 1, 10, 2);

      mockCorrugationDAO.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = createPaginatedRequest(1, 10) as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationDAO.getAllWithFilters).toHaveBeenCalledWith(mockReq);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(paginatedResult);
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockCorrugationDAO.getAllWithFilters.mockRejectedValue(error);

      const mockReq = createPaginatedRequest() as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getByUuid', () => {
    it('should return corrugation when found', async () => {
      const testData = createTestCorrugationResponse();
      mockCorrugationDAO.getByUuid.mockResolvedValue(testData);

      const mockReq = createUuidParamRequest(testData.uuid) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationDAO.getByUuid).toHaveBeenCalledWith(testData.uuid, undefined);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: testData,
      });
    });

    it('should return 404 when corrugation not found', async () => {
      mockCorrugationDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation not found',
      });
    });
  });

  describe('create', () => {
    it('should create corrugation with valid input and class UUID', async () => {
      const inputData = {
        code: 'NEW001',
        description: 'New Corrugation',
        theoreticalGrammage: 150,
        suggestedWidth: 1200,
        caliper: 3.5,
        corrugationClassUuid: 'class-uuid-123',
      };
      const createdData = createTestCorrugationResponse({
        uuid: 'generated-uuid',
        code: 'NEW001',
        description: 'New Corrugation',
      });

      mockCorrugationClassDAO.getIdByUuid.mockResolvedValue(5); // class internal ID
      mockCorrugationDAO.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationClassDAO.getIdByUuid).toHaveBeenCalledWith('class-uuid-123');
      expect(mockCorrugationDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'generated-uuid',
          code: 'NEW001',
          corrugationClassId: 5,
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should create corrugation without class UUID', async () => {
      const inputData = {
        code: 'NEW001',
        description: 'New Corrugation',
      };
      const createdData = createTestCorrugationResponse({
        uuid: 'generated-uuid',
        code: 'NEW001',
      });

      mockCorrugationDAO.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationClassDAO.getIdByUuid).not.toHaveBeenCalled();
      expect(mockCorrugationDAO.create).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should return 400 when corrugation class not found', async () => {
      const inputData = {
        code: 'NEW001',
        corrugationClassUuid: 'non-existent-class',
      };

      mockCorrugationClassDAO.getIdByUuid.mockResolvedValue(null);

      const mockReq = createBodyRequest(inputData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation class not found',
      });
    });

    it('should call next with error on validation failure', async () => {
      const invalidData = { code: '', description: 'Test' };
      const mockReq = createBodyRequest(invalidData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update corrugation when found', async () => {
      const existingId = 1;
      const testUuid = 'existing-uuid';
      const updateData = { code: 'UPDATED', description: 'Updated description' };
      const updatedData = createTestCorrugationResponse({
        uuid: testUuid,
        code: 'UPDATED',
      });

      mockCorrugationDAO.getIdByUuid.mockResolvedValue(existingId);
      mockCorrugationDAO.update.mockResolvedValue(updatedData);

      const mockReq = {
        ...createUuidParamRequest(testUuid),
        body: updateData,
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationDAO.getIdByUuid).toHaveBeenCalledWith(testUuid, undefined);
      expect(mockCorrugationDAO.update).toHaveBeenCalledWith(existingId, expect.any(Object));
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should update corrugation class ID when class UUID provided', async () => {
      const existingId = 1;
      const testUuid = 'existing-uuid';
      const classId = 10;
      const updateData = {
        code: 'UPDATED',
        corrugationClassUuid: 'new-class-uuid',
      };

      mockCorrugationDAO.getIdByUuid.mockResolvedValue(existingId);
      mockCorrugationClassDAO.getIdByUuid.mockResolvedValue(classId);
      mockCorrugationDAO.update.mockResolvedValue(createTestCorrugationResponse());

      const mockReq = {
        ...createUuidParamRequest(testUuid),
        body: updateData,
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationClassDAO.getIdByUuid).toHaveBeenCalledWith('new-class-uuid');
      expect(mockCorrugationDAO.update).toHaveBeenCalledWith(
        existingId,
        expect.objectContaining({ corrugationClassId: classId })
      );
    });

    it('should return 404 when corrugation not found for update', async () => {
      mockCorrugationDAO.getIdByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest('non-existent-uuid'),
        body: { code: 'UPDATED' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation not found',
      });
    });

    it('should return 400 when updated class UUID not found', async () => {
      mockCorrugationDAO.getIdByUuid.mockResolvedValue(1);
      mockCorrugationClassDAO.getIdByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest('existing-uuid'),
        body: { code: 'UPDATED', corrugationClassUuid: 'invalid-class' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation class not found',
      });
    });
  });

  describe('delete', () => {
    it('should delete corrugation when found', async () => {
      const existingId = 1;
      const testUuid = 'existing-uuid';

      mockCorrugationDAO.getIdByUuid.mockResolvedValue(existingId);
      mockCorrugationDAO.delete.mockResolvedValue(true);

      const mockReq = createUuidParamRequest(testUuid) as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationDAO.getIdByUuid).toHaveBeenCalledWith(testUuid, undefined);
      expect(mockCorrugationDAO.delete).toHaveBeenCalledWith(existingId);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Corrugation deleted successfully',
      });
    });

    it('should return 404 when corrugation not found for delete', async () => {
      mockCorrugationDAO.getIdByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Corrugation not found',
      });
    });

    it('should return 404 when delete operation fails', async () => {
      mockCorrugationDAO.getIdByUuid.mockResolvedValue(1);
      mockCorrugationDAO.delete.mockResolvedValue(false);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to delete corrugation',
      });
    });
  });

  describe('Security: UUID-to-ID conversion', () => {
    it('should convert class UUID to internal ID for create', async () => {
      const classUuid = 'class-uuid';
      const classId = 42;

      mockCorrugationClassDAO.getIdByUuid.mockResolvedValue(classId);
      mockCorrugationDAO.create.mockResolvedValue(createTestCorrugationResponse());

      const mockReq = createBodyRequest({
        code: 'NEW001',
        corrugationClassUuid: classUuid,
      }) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockCorrugationClassDAO.getIdByUuid).toHaveBeenCalledWith(classUuid);
      expect(mockCorrugationDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({ corrugationClassId: classId })
      );
    });
  });
});
