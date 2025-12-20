// @ts-nocheck
/**
 * UserDAO Unit Tests
 * Tests for the User data access layer
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createTestUser,
  createTestCompany,
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
import { UserDAO } from '../../../dao/user/user.dao';

describe('UserDAO', () => {
  let dao: UserDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = { now: jest.fn().mockReturnValue(new Date().toISOString()) };
    (mockKnex as any).raw = jest.fn().mockReturnValue('');

    dao = new UserDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a new user and return it', async () => {
      const testData = createTestUser();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        email: testData.email,
        password: testData.password,
        firstName: testData.firstName,
        lastName: testData.lastName,
        role: testData.role,
        companyId: testData.companyId,
        isActive: testData.isActive,
        emailVerified: testData.emailVerified,
      } as any);

      expect(mockKnex).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          email: testData.email,
          firstName: testData.firstName,
          lastName: testData.lastName,
          role: testData.role,
          companyId: testData.companyId,
        })
      );
      expect(mockQueryBuilder.returning).toHaveBeenCalledWith('*');
      expect(result.email).toBe(testData.email);
      expect(result.uuid).toBe(testData.uuid);
    });

    it('should set default values for isActive and emailVerified', async () => {
      const testData = createTestUser({ isActive: undefined, emailVerified: undefined });
      mockQueryBuilder.returning.mockResolvedValue([{ ...testData, isActive: true, emailVerified: false }]);

      await dao.create({
        email: testData.email,
        password: testData.password,
        firstName: testData.firstName,
        lastName: testData.lastName,
        role: testData.role,
        companyId: testData.companyId,
      } as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          emailVerified: false,
        })
      );
    });
  });

  describe('getById', () => {
    it('should return user by numeric ID', async () => {
      const testData = createTestUser();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(mockQueryBuilder.first).toHaveBeenCalled();
      expect(result?.email).toBe(testData.email);
      expect(result?.uuid).toBe(testData.uuid);
    });

    it('should return null when user not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('getByUuid', () => {
    it('should return user by UUID', async () => {
      const testData = createTestUser();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('uuid', testData.uuid);
      expect(result?.email).toBe(testData.email);
    });

    it('should return null when user not found by UUID', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('getIdByUuid', () => {
    it('should return internal numeric ID for a given UUID', async () => {
      const testData = createTestUser();
      mockQueryBuilder.first.mockResolvedValue({ id: testData.id });

      const result = await dao.getIdByUuid(testData.uuid);

      expect(mockKnex).toHaveBeenCalledWith('users');
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
    it('should update user by numeric ID', async () => {
      const testData = createTestUser();
      const updatedData = { ...testData, firstName: 'Updated', lastName: 'Name' };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        firstName: 'Updated',
        lastName: 'Name',
      });

      expect(mockKnex).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Updated',
          lastName: 'Name',
        })
      );
      expect(result?.firstName).toBe('Updated');
      expect(result?.lastName).toBe('Name');
    });

    it('should only update provided fields', async () => {
      const testData = createTestUser();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { firstName: 'NewName' });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock.calls[0][0];
      expect(updateCall).toHaveProperty('firstName', 'NewName');
      expect(updateCall).not.toHaveProperty('lastName');
      expect(updateCall).not.toHaveProperty('email');
    });

    it('should return null when updating non-existent user', async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { firstName: 'Updated' });

      expect(result).toBeNull();
    });

    it('should update password when provided', async () => {
      const testData = createTestUser();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { password: 'newHashedPassword' });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'newHashedPassword' })
      );
    });
  });

  describe('delete', () => {
    it('should delete user by numeric ID and return true', async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id', 1);
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when user not found', async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return paginated users with company name', async () => {
      const company = createTestCompany();
      const testData = [
        createTestUser({ id: 1, companyId: company.id, companyName: company.name }),
        createTestUser({ id: 2, companyId: company.id, companyName: company.name }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: '2' });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(2);
    });

    it('should include left join for company', async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        'companies',
        'users.companyId',
        'companies.id'
      );
    });

    it('should order by createdAt descending', async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: '0' });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('users.createdAt', 'desc');
    });

    it('should calculate correct pagination', async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestUser()]);
      mockQueryBuilder.first.mockResolvedValue({ count: '25' });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });
  });

  describe('getAllByCompany', () => {
    it('should return paginated users filtered by company', async () => {
      const company = createTestCompany();
      const testData = [createTestUser({ companyId: company.id })];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: '1' });

      const result = await dao.getAllByCompany(company.id, 1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('users.companyId', company.id);
    });
  });

  describe('getUserByEmail', () => {
    it('should return user by email', async () => {
      const testData = createTestUser();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getUserByEmail(testData.email);

      expect(mockKnex).toHaveBeenCalledWith('users');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('email', testData.email);
      expect(result?.email).toBe(testData.email);
    });

    it('should return null when email not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getUserByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('getUserByEmailWithCompany', () => {
    it('should return user with company details', async () => {
      const company = createTestCompany();
      const testData = createTestUser({ companyId: company.id, company });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getUserByEmailWithCompany(testData.email);

      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        'companies',
        'users.companyId',
        'companies.id'
      );
      expect(result?.email).toBe(testData.email);
      // Password should be removed from response
      expect(result).not.toHaveProperty('password');
    });

    it('should return null when email not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getUserByEmailWithCompany('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('getUserWithCompany', () => {
    it('should return user with company by UUID', async () => {
      const company = createTestCompany();
      const testData = createTestUser({ companyId: company.id, company });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getUserWithCompany(testData.uuid);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('users.uuid', testData.uuid);
      expect(result?.uuid).toBe(testData.uuid);
      // Password should be removed from response
      expect(result).not.toHaveProperty('password');
    });

    it('should return null when UUID not found', async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getUserWithCompany('non-existent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('Role validation', () => {
    it('should handle member role', async () => {
      const testData = createTestUser({ role: 'member' });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.role).toBe('member');
    });

    it('should handle admin role', async () => {
      const testData = createTestUser({ role: 'admin' });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.role).toBe('admin');
    });
  });
});
