// @ts-nocheck
/**
 * InvitationDAO Unit Tests
 * Tests for the Invitation data access layer
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTestInvitation, resetIdCounter } from "../../mocks/factories";
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
import { InvitationDAO } from "../../../dao/invitation/invitation.dao";

describe("InvitationDAO", () => {
  let dao: InvitationDAO;

  beforeEach(() => {
    resetIdCounter();

    // Create fresh mocks for each test
    mockQueryBuilder = createMockQueryBuilder();
    mockKnex = jest.fn().mockReturnValue(mockQueryBuilder);
    (mockKnex as any).fn = {
      now: jest.fn().mockReturnValue(new Date().toISOString()),
    };

    dao = new InvitationDAO();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("create", () => {
    it("should create a new invitation and return it", async () => {
      const testData = createTestInvitation();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create({
        uuid: testData.uuid,
        email: testData.email,
        token: testData.token,
        role: testData.role,
        companyId: testData.companyId,
        invitedBy: testData.invitedBy,
        expiresAt: testData.expiresAt,
        isUsed: testData.isUsed,
      } as any);

      const crypto = require("crypto");
      const expectedHash = crypto
        .createHash("sha256")
        .update(testData.token)
        .digest("hex");

      expect(mockKnex).toHaveBeenCalledWith("invitations");
      // SECURITY (M5): the stored token is the SHA-256 hash, not the raw value.
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: testData.uuid,
          email: testData.email,
          token: expectedHash,
          role: testData.role,
        }),
      );
      expect(result.email).toBe(testData.email);
      expect(result.uuid).toBe(testData.uuid);
      // SECURITY (C4): create returns the token-less shape.
      expect(result.token).toBeUndefined();
    });

    it("should set default value for isUsed to false", async () => {
      const testData = createTestInvitation({ isUsed: undefined });
      mockQueryBuilder.returning.mockResolvedValue([
        { ...testData, isUsed: false },
      ]);

      await dao.create({
        uuid: testData.uuid,
        email: testData.email,
        token: testData.token,
        role: testData.role,
        companyId: testData.companyId,
        invitedBy: testData.invitedBy,
        expiresAt: testData.expiresAt,
      } as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          isUsed: false,
        }),
      );
    });
  });

  describe("getById", () => {
    it("should return invitation by numeric ID", async () => {
      const testData = createTestInvitation();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(mockKnex).toHaveBeenCalledWith("invitations");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(result?.email).toBe(testData.email);
    });

    it("should return null when invitation not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getById(999);

      expect(result).toBeNull();
    });
  });

  describe("getByUuid", () => {
    it("should return invitation by UUID", async () => {
      const testData = createTestInvitation();
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getByUuid(testData.uuid);

      // SECURITY (C4): column is now table-qualified to support the optional company join.
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "invitations.uuid",
        testData.uuid,
      );
      expect(result?.email).toBe(testData.email);
      // SECURITY (C4): token must never be returned in single-record responses.
      expect(result?.token).toBeUndefined();
    });

    it("should return null when invitation not found by UUID", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByUuid("non-existent-uuid");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update invitation by numeric ID", async () => {
      const testData = createTestInvitation();
      const updatedData = {
        ...testData,
        isUsed: true,
        acceptedAt: new Date().toISOString(),
      };
      mockQueryBuilder.returning.mockResolvedValue([updatedData]);

      const result = await dao.update(testData.id, {
        isUsed: true,
        acceptedAt: updatedData.acceptedAt,
      });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", testData.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          isUsed: true,
          acceptedAt: updatedData.acceptedAt,
        }),
      );
      expect(result?.isUsed).toBe(true);
    });

    it("should only update provided fields", async () => {
      const testData = createTestInvitation();
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      await dao.update(testData.id, { isUsed: true });

      const updateCall = (mockQueryBuilder.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall).toHaveProperty("isUsed", true);
      expect(updateCall).not.toHaveProperty("email");
      expect(updateCall).not.toHaveProperty("token");
    });

    it("should return null when updating non-existent invitation", async () => {
      mockQueryBuilder.returning.mockResolvedValue([]);

      const result = await dao.update(999, { isUsed: true });

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete invitation by numeric ID and return true", async () => {
      mockQueryBuilder.delete.mockResolvedValue(1);

      const result = await dao.delete(1);

      expect(mockKnex).toHaveBeenCalledWith("invitations");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", 1);
      expect(result).toBe(true);
    });

    it("should return false when invitation not found", async () => {
      mockQueryBuilder.delete.mockResolvedValue(0);

      const result = await dao.delete(999);

      expect(result).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return paginated invitations", async () => {
      const testData = [
        createTestInvitation({ id: 1 }),
        createTestInvitation({ id: 2 }),
      ];

      mockQueryBuilder.offset.mockResolvedValue(testData);
      mockQueryBuilder.first.mockResolvedValue({ count: "2" });

      const result = await dao.getAll(1, 10);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it("should order by created_at descending", async () => {
      mockQueryBuilder.offset.mockResolvedValue([]);
      mockQueryBuilder.first.mockResolvedValue({ count: "0" });

      await dao.getAll(1, 10);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "invitations.created_at",
        "desc",
      );
    });

    it("should calculate correct pagination", async () => {
      mockQueryBuilder.offset.mockResolvedValue([createTestInvitation()]);
      mockQueryBuilder.first.mockResolvedValue({ count: "25" });

      const result = await dao.getAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(3);
    });
  });

  describe("getByToken", () => {
    it("should look up by the SHA-256 hash of the raw token", async () => {
      const crypto = require("crypto");
      const testData = createTestInvitation();
      const expectedHash = crypto
        .createHash("sha256")
        .update(testData.token)
        .digest("hex");
      // The stored row carries the hash, not the raw token.
      mockQueryBuilder.first.mockResolvedValue({
        ...testData,
        token: expectedHash,
      });

      const result = await dao.getByToken(testData.token);

      expect(mockKnex).toHaveBeenCalledWith("invitations");
      // SECURITY (M5): lookup is by hash of the raw token, never the raw token.
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "token",
        expectedHash,
      );
      expect(result?.email).toBe(testData.email);
    });

    it("should return null when token not found", async () => {
      mockQueryBuilder.first.mockResolvedValue(null);

      const result = await dao.getByToken("invalid-token");

      expect(result).toBeNull();
    });
  });

  describe("getActiveInvitations", () => {
    it("should return active invitations (token stripped)", async () => {
      const testData = [
        createTestInvitation({ companyId: 1, isUsed: false }),
        createTestInvitation({ companyId: 1, isUsed: false }),
      ];

      mockQueryBuilder.orderBy.mockResolvedValue(testData);

      // SECURITY (C4): now scoped by company UUID (or undefined for all).
      const result = await dao.getActiveInvitations();

      expect(mockKnex).toHaveBeenCalledWith("invitations");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "invitations.isUsed",
        false,
      );
      expect(result).toHaveLength(2);
      // SECURITY (C4): token stripped from active-list responses.
      expect(result.every((i: any) => i.token === undefined)).toBe(true);
    });

    it("should filter out used invitations", async () => {
      mockQueryBuilder.orderBy.mockResolvedValue([]);

      const result = await dao.getActiveInvitations();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "invitations.isUsed",
        false,
      );
      expect(result).toHaveLength(0);
    });

    it("should order by created_at descending", async () => {
      mockQueryBuilder.orderBy.mockResolvedValue([]);

      await dao.getActiveInvitations();

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "invitations.created_at",
        "desc",
      );
    });
  });

  describe("Role validation", () => {
    it("should handle member role", async () => {
      const testData = createTestInvitation({ role: "member" });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.role).toBe("member");
    });

    it("should handle admin role", async () => {
      const testData = createTestInvitation({ role: "admin" });
      mockQueryBuilder.first.mockResolvedValue(testData);

      const result = await dao.getById(testData.id);

      expect(result?.role).toBe("admin");
    });
  });

  describe("Expiration handling", () => {
    it("should create invitation with expiration date", async () => {
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const testData = createTestInvitation({ expiresAt });
      mockQueryBuilder.returning.mockResolvedValue([testData]);

      const result = await dao.create(testData as any);

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt }),
      );
      expect(result.expiresAt).toBe(expiresAt);
    });

    it("should update acceptedAt when invitation is accepted", async () => {
      const testData = createTestInvitation();
      const acceptedAt = new Date();
      mockQueryBuilder.returning.mockResolvedValue([
        { ...testData, acceptedAt, isUsed: true },
      ]);

      const result = await dao.update(testData.id, {
        acceptedAt,
        isUsed: true,
      });

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedAt, isUsed: true }),
      );
      expect(result?.acceptedAt).toBe(acceptedAt);
    });
  });
});
