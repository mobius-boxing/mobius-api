// @ts-nocheck
/**
 * UsersController Unit Tests
 * Tests for the Users API controller
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
  createTestUser,
  createPaginatedResponse,
  resetIdCounter,
} from '../../mocks/factories';

// Store reference to mock functions
const mockUserDAO = {
  getAll: jest.fn(),
  getAllWithFilters: jest.fn(),
  getAllByCompany: jest.fn(),
  getByUuid: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserWithCompany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockInvitationDAO = {
  create: jest.fn(),
};

const mockCompanyDAO = {
  getByUuid: jest.fn(),
  getById: jest.fn(),
};

const mockEmailService = {
  sendInvitationEmail: jest.fn(),
};

// Mock uuid module
jest.mock('uuid', () => ({
  v4: () => 'generated-uuid',
}));

// Mock crypto module
jest.mock('crypto', () => ({
  randomBytes: () => ({
    toString: () => 'mock-token-12345',
  }),
}));

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

// Mock the UserDAO module
jest.mock('../../../dao/user/user.dao', () => {
  const { mockUserDAO: mf } = require('./users.controller.test');
  return {
    UserDAO: function() {
      return {
        getAll: (...args) => mf.getAll(...args),
        getAllWithFilters: (...args) => mf.getAllWithFilters(...args),
        getAllByCompany: (...args) => mf.getAllByCompany(...args),
        getByUuid: (...args) => mf.getByUuid(...args),
        getUserByEmail: (...args) => mf.getUserByEmail(...args),
        getUserWithCompany: (...args) => mf.getUserWithCompany(...args),
        create: (...args) => mf.create(...args),
        update: (...args) => mf.update(...args),
        delete: (...args) => mf.delete(...args),
      };
    },
  };
});

// Mock the InvitationDAO module
jest.mock('../../../dao/invitation/invitation.dao', () => {
  const { mockInvitationDAO: mf } = require('./users.controller.test');
  return {
    InvitationDAO: function() {
      return {
        create: (...args) => mf.create(...args),
      };
    },
  };
});

// Mock the CompanyDAO module
jest.mock('../../../dao/company/company.dao', () => {
  const { mockCompanyDAO: mf } = require('./users.controller.test');
  return {
    CompanyDAO: function() {
      return {
        getByUuid: (...args) => mf.getByUuid(...args),
        getById: (...args) => mf.getById(...args),
      };
    },
  };
});

// Mock the EmailService
jest.mock('../../../services/email.service', () => {
  const { mockEmailService: mf } = require('./users.controller.test');
  return {
    EmailService: function() {
      return {
        sendInvitationEmail: (...args) => mf.sendInvitationEmail(...args),
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
    if (!dto.email || !dto.email.includes('@')) {
      return { success: false, message: 'Valid email is required' };
    }
    return { success: true, message: '' };
  },
}));

// Export mock functions for access in the mock
export { mockUserDAO, mockInvitationDAO, mockCompanyDAO, mockEmailService };

// Import controller after mocking
import { UsersController } from '../../../controllers/users/users.controller';

describe('UsersController', () => {
  let controller: UsersController;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    resetIdCounter();
    mockRes = createMockResponse();
    mockNext = createMockNext();

    // Reset all mock functions
    mockUserDAO.getAll.mockReset();
    mockUserDAO.getAllWithFilters.mockReset();
    mockUserDAO.getAllByCompany.mockReset();
    mockUserDAO.getByUuid.mockReset();
    mockUserDAO.getUserByEmail.mockReset();
    mockUserDAO.getUserWithCompany.mockReset();
    mockUserDAO.create.mockReset();
    mockUserDAO.update.mockReset();
    mockUserDAO.delete.mockReset();
    mockInvitationDAO.create.mockReset();
    mockCompanyDAO.getByUuid.mockReset();
    mockCompanyDAO.getById.mockReset();
    mockEmailService.sendInvitationEmail.mockReset();

    // Create controller instance
    controller = new UsersController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return all users for superAdmin', async () => {
      const testData = [
        createTestUser({ email: 'user1@test.com', password: 'secret' }),
        createTestUser({ email: 'user2@test.com', password: 'secret' }),
      ];
      const paginatedResult = createPaginatedResponse(testData, 1, 10, 2);

      mockUserDAO.getAllWithFilters.mockResolvedValue(paginatedResult);

      const mockReq = {
        ...createPaginatedRequest(1, 10),
        user: { role: 'superAdmin', userId: 'admin-uuid' },
      } as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockUserDAO.getAllWithFilters).toHaveBeenCalledWith(mockReq);
      expect(mockRes.status).toHaveBeenCalledWith(200);

      // Verify password is removed from response
      const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.data[0]).not.toHaveProperty('password');
    });

    it('should return company users for admin', async () => {
      const adminUser = createTestUser({ id: 1, uuid: 'admin-uuid', companyId: 5 });
      const companyUsers = [
        createTestUser({ email: 'user1@test.com', companyId: 5 }),
      ];
      const paginatedResult = createPaginatedResponse(companyUsers, 1, 10, 1);

      mockUserDAO.getByUuid.mockResolvedValue(adminUser);
      mockUserDAO.getAllByCompany.mockResolvedValue(paginatedResult);

      const mockReq = {
        ...createPaginatedRequest(1, 10),
        user: { role: 'admin', userId: 'admin-uuid' },
      } as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockUserDAO.getByUuid).toHaveBeenCalledWith('admin-uuid');
      expect(mockUserDAO.getAllByCompany).toHaveBeenCalledWith(5, 1, 10);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 403 if admin has no company', async () => {
      const adminUser = createTestUser({ uuid: 'admin-uuid', companyId: undefined });

      mockUserDAO.getByUuid.mockResolvedValue(adminUser);

      const mockReq = {
        ...createPaginatedRequest(),
        user: { role: 'admin', userId: 'admin-uuid' },
      } as Request;

      await controller.getAll(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Admin user must be assigned to a company',
      });
    });
  });

  describe('getByUuid', () => {
    it('should return user without password', async () => {
      const testData = createTestUser({ password: 'secret-password' });
      mockUserDAO.getByUuid.mockResolvedValue(testData);

      // callerCanAccessUser requires an authenticated caller (tenant guard).
      const mockReq = createUuidParamRequest(testData.uuid, {
        user: { role: 'superAdmin', userId: 'caller-uuid' },
      } as any) as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);

      const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
    });

    it('should return 404 when user not found', async () => {
      mockUserDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.getByUuid(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('create', () => {
    it('should create user with hashed password', async () => {
      const inputData = {
        email: 'new@test.com',
        // SECURITY (M4): must satisfy the password policy (>=12, upper, lower, digit).
        password: 'PlainPassword1',
        firstName: 'John',
        lastName: 'Doe',
        role: 'member',
        companyId: 1,
      };
      const createdData = createTestUser({
        uuid: 'generated-uuid',
        email: 'new@test.com',
        firstName: 'John',
      });

      mockUserDAO.getUserByEmail.mockResolvedValue(null);
      mockUserDAO.create.mockResolvedValue(createdData);

      const mockReq = createBodyRequest(inputData) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockUserDAO.getUserByEmail).toHaveBeenCalledWith('new@test.com');
      expect(mockUserDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'generated-uuid',
          email: 'new@test.com',
          isActive: true,
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should return 400 if email already exists', async () => {
      const existingUser = createTestUser({ email: 'existing@test.com' });
      mockUserDAO.getUserByEmail.mockResolvedValue(existingUser);

      const mockReq = createBodyRequest({
        email: 'existing@test.com',
        password: 'password',
      }) as Request;

      await controller.create(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'User with this email already exists',
      });
    });
  });

  describe('update', () => {
    it('should update user when found', async () => {
      const existingUser = createTestUser({ id: 1, uuid: 'existing-uuid' });
      const updatedUser = { ...existingUser, firstName: 'Updated' };

      mockUserDAO.getByUuid.mockResolvedValue(existingUser);
      mockUserDAO.update.mockResolvedValue(updatedUser);

      const mockReq = {
        ...createUuidParamRequest('existing-uuid'),
        // SECURITY (C3): update now requires an authenticated actor; superAdmin has full access.
        user: { userId: 'admin-uuid', role: 'superAdmin' },
        body: { firstName: 'Updated', email: 'test@test.com' },
      } as unknown as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockUserDAO.update).toHaveBeenCalledWith(1, expect.any(Object));
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 when user not found', async () => {
      mockUserDAO.getByUuid.mockResolvedValue(null);

      const mockReq = {
        ...createUuidParamRequest('non-existent-uuid'),
        body: { firstName: 'Updated', email: 'test@test.com' },
      } as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should convert company UUID to ID', async () => {
      const existingUser = createTestUser({ id: 1 });
      const company = { id: 5, uuid: 'company-uuid', name: 'Test Co' };

      mockUserDAO.getByUuid.mockResolvedValue(existingUser);
      mockCompanyDAO.getByUuid.mockResolvedValue(company);
      mockUserDAO.update.mockResolvedValue(existingUser);

      const mockReq = {
        ...createUuidParamRequest('user-uuid'),
        // SECURITY (C3): only superAdmins may reassign a user's company (UUID → id resolution).
        user: { userId: 'admin-uuid', role: 'superAdmin' },
        body: { companyId: 'company-uuid', email: 'test@test.com' },
      } as unknown as Request;

      await controller.update(mockReq, mockRes as Response, mockNext);

      expect(mockCompanyDAO.getByUuid).toHaveBeenCalledWith('company-uuid');
    });
  });

  describe('delete', () => {
    it('should delete user when found', async () => {
      const existingUser = createTestUser({ id: 1 });

      mockUserDAO.getByUuid.mockResolvedValue(existingUser);
      mockUserDAO.delete.mockResolvedValue(true);

      const mockReq = createUuidParamRequest('existing-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockUserDAO.delete).toHaveBeenCalledWith(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'User deleted successfully',
      });
    });

    it('should return 404 when user not found', async () => {
      mockUserDAO.getByUuid.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.delete(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getWithCompany', () => {
    it('should return user with company details', async () => {
      const userWithCompany = {
        ...createTestUser(),
        company: { id: 1, name: 'Test Company' },
      };

      mockUserDAO.getUserWithCompany.mockResolvedValue(userWithCompany);

      // callerCanAccessUser requires an authenticated caller (tenant guard).
      const mockReq = createUuidParamRequest('test-uuid', {
        user: { role: 'superAdmin', userId: 'caller-uuid' },
      } as any) as Request;

      await controller.getWithCompany(mockReq, mockRes as Response, mockNext);

      expect(mockUserDAO.getUserWithCompany).toHaveBeenCalledWith('test-uuid');
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 when user not found', async () => {
      mockUserDAO.getUserWithCompany.mockResolvedValue(null);

      const mockReq = createUuidParamRequest('non-existent-uuid') as Request;

      await controller.getWithCompany(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getByEmail', () => {
    it('should return user without password', async () => {
      const testData = createTestUser({ email: 'test@test.com', password: 'secret' });
      mockUserDAO.getUserByEmail.mockResolvedValue(testData);

      const mockReq = {
        ...createMockRequest(),
        params: { email: 'test@test.com' },
      } as Request;

      await controller.getByEmail(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
    });

    it('should return 404 when user not found', async () => {
      mockUserDAO.getUserByEmail.mockResolvedValue(null);

      const mockReq = {
        ...createMockRequest(),
        params: { email: 'notfound@test.com' },
      } as Request;

      await controller.getByEmail(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('invite', () => {
    it('should create invitation and send email', async () => {
      const inviter = createTestUser({ id: 1, uuid: 'inviter-uuid', companyId: 5 });
      const company = { id: 5, uuid: 'company-uuid', name: 'Test Company' };
      const invitation = { uuid: 'generated-uuid', email: 'invite@test.com' };

      mockUserDAO.getByUuid.mockResolvedValue(inviter);
      mockCompanyDAO.getById.mockResolvedValue(company);
      mockInvitationDAO.create.mockResolvedValue(invitation);
      mockEmailService.sendInvitationEmail.mockResolvedValue(undefined);

      const mockReq = {
        ...createBodyRequest({
          email: 'invite@test.com',
          role: 'member',
          firstName: 'Invitee',
        }),
        user: { userId: 'inviter-uuid' },
      } as Request;

      await controller.invite(mockReq, mockRes as Response, mockNext);

      expect(mockInvitationDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'invite@test.com',
          role: 'member',
          companyId: 5,
        })
      );
      expect(mockEmailService.sendInvitationEmail).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should return 401 without authentication', async () => {
      const mockReq = createBodyRequest({
        email: 'invite@test.com',
        role: 'member',
      }) as Request;

      await controller.invite(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 400 without email or role', async () => {
      const mockReq = {
        ...createBodyRequest({ email: 'test@test.com' }),
        user: { userId: 'user-uuid' },
      } as Request;

      await controller.invite(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Email and role are required',
      });
    });
  });
});
