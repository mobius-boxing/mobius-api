// @ts-nocheck
/**
 * CompaniesController Unit Tests
 * Tests for the Companies API controller
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
  createTestCompany,
  createPaginatedResponse,
  resetIdCounter,
} from '../../mocks/factories';

// Store reference to mock functions
const mockCompanyDAO = {
  getAll: jest.fn(),
  getAllWithFilters: jest.fn(),
  getByUuid: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  getCompanyWithUserCount: jest.fn(),
};

// Mock uuid module
jest.mock('uuid', () => ({
  v4: () => 'generated-uuid',
}));

// Mock the CompanyDAO module
jest.mock('../../../dao/company/company.dao', () => {
  const { mockCompanyDAO: mf } = require('./companies.controller.test');
  return {
    CompanyDAO: function() {
      return {
        getAll: (...args) => mf.getAll(...args),
        getAllWithFilters: (...args) => mf.getAllWithFilters(...args),
        getByUuid: (...args) => mf.getByUuid(...args),
        create: (...args) => mf.create(...args),
        update: (...args) => mf.update(...args),
        delete: (...args) => mf.delete(...args),
        getCompanyWithUserCount: (...args) => mf.getCompanyWithUserCount(...args),
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
    if (!dto.name || dto.name.trim() === '') {
      return { success: false, message: 'Name is required' };
    }
    return { success: true, message: '' };
  },
}));

// Export mock functions for access in the mock
export { mockCompanyDAO };

// Import controller after mocking
import { CompaniesController } from '../../../controllers/companies/companies.controller';

describe('CompaniesController', () => {
  let controller: CompaniesController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();

    // Reset all mock functions
    mockCompanyDAO.getAll.mockReset();
    mockCompanyDAO.getAllWithFilters.mockReset();
    mockCompanyDAO.getByUuid.mockReset();
    mockCompanyDAO.create.mockReset();
    mockCompanyDAO.update.mockReset();
    mockCompanyDAO.delete.mockReset();
    mockCompanyDAO.getCompanyWithUserCount.mockReset();

    // Create controller instance
    controller = new CompaniesController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return paginated companies', async () => {
      const testData = [
        createTestCompany({ name: 'Company A' }),
        createTestCompany({ name: 'Company B' }),
      ];
      const paginatedResult = createPaginatedResponse(testData, 1, 10, 2);

      mockCompanyDAO.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = createPaginatedRequest(1, 10) as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getAllWithFilters).toHaveBeenCalledWith(mockReq);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(paginatedResult);
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockCompanyDAO.getAllWithFilters.mockRejectedValue(error);

      const mockReq = createPaginatedRequest() as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getByUuid', () => {
    it('should return company when found', async () => {
      const testData = createTestCompany();
      mockCompanyDAO.getByUuid.mockResolvedValue(testData);

      const mockReq = createUuidParamRequest(testData.uuid) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith(testData.uuid);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: testData,
      });
    });

    it('should return 404 when company not found', async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Company not found',
      });
    });
  });

  describe('create', () => {
    it('should create company with valid input', async () => {
      const inputData = { name: 'New Company', description: 'Description' };
      const createdData = createTestCompany({
        uuid: 'generated-uuid',
        name: 'New Company',
        description: 'Description',
      });

      mockCompanyDAO.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'generated-uuid',
          name: 'New Company',
          isActive: true,
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should call next with error on validation failure', async () => {
      const invalidData = { name: '', description: 'Test' };
      const mockReq = createBodyRequest(invalidData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockCompanyDAO.create.mockRejectedValue(error);

      const mockReq = createBodyRequest({ name: 'New Company' }) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('update', () => {
    it('should update company when found', async () => {
      const existingCompany = createTestCompany({ id: 1, uuid: 'existing-uuid' });
      const updateData = { name: 'Updated Name' };
      const updatedCompany = { ...existingCompany, name: 'Updated Name' };

      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockCompanyDAO.update.mockResolvedValue(updatedCompany);

      const mockReq = {
        ...createUuidParamRequest('existing-uuid'),
        body: updateData,
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith('existing-uuid');
      expect(mockCompanyDAO.update).toHaveBeenCalledWith(1, expect.any(Object));
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 when company not found', async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest('non-existent-uuid'),
        body: { name: 'Updated' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Company not found',
      });
    });

    it('should return 404 when company has no id', async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue({ uuid: 'test', name: 'Test' }); // no id

      const mockReq = {
        ...createUuidParamRequest('test-uuid'),
        body: { name: 'Updated' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('delete', () => {
    it('should delete company when found', async () => {
      const existingCompany = createTestCompany({ id: 1, uuid: 'existing-uuid' });

      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockCompanyDAO.delete.mockResolvedValue(true);

      const mockReq = createUuidParamRequest('existing-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith('existing-uuid');
      expect(mockCompanyDAO.delete).toHaveBeenCalledWith(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Company deleted successfully',
      });
    });

    it('should return 404 when company not found', async () => {
      mockCompanyDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Company not found',
      });
    });

    it('should return 404 when delete fails', async () => {
      const existingCompany = createTestCompany({ id: 1 });

      mockCompanyDAO.getByUuid.mockResolvedValue(existingCompany);
      mockCompanyDAO.delete.mockResolvedValue(false);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to delete company',
      });
    });
  });

  describe('getWithUserCount', () => {
    it('should return company with user count', async () => {
      const companyWithCount = {
        ...createTestCompany(),
        userCount: 5,
      };

      mockCompanyDAO.getCompanyWithUserCount.mockResolvedValue(companyWithCount);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.getWithUserCount(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getCompanyWithUserCount).toHaveBeenCalledWith('test-uuid');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: companyWithCount,
      });
    });

    it('should return 404 when company not found', async () => {
      mockCompanyDAO.getCompanyWithUserCount.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.getWithUserCount(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Company not found',
      });
    });

    it('should call next with error on DAO failure', async () => {
      const error = new Error('Database error');
      mockCompanyDAO.getCompanyWithUserCount.mockRejectedValue(error);

      const mockReq = createUuidParamRequest('test-uuid') as Request;

      await controller.getWithUserCount(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
