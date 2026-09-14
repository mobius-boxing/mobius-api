/**
 * `GET/POST /api/companies/:uuid/tenant-database[/provision|/suspend|/resume]`
 * (db-per-company T10, model). What is pinned here:
 *  - the exact response shape (AC-57/AC-58): no `id`, `companyId`, `serverId`,
 *    `dbUser`, `credentialRef`, `credentialCiphertext`, `adminUser`,
 *    `adminCredentialRef` or a tenant `host` ever leaves this controller;
 *  - `provision` answers 202 with the row's real `"provisioning"` state and
 *    fires the rest of the work without awaiting it (AC-59, model D-19);
 *  - `suspend`/`resume` are a CAS through `TenantDatabaseDAO.transition`, and
 *    anything outside `active<->suspended` is 409 `TENANT_STATUS_CONFLICT`
 *    with `{status}` in `data` (AC-60).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import {
  createMockResponse,
  createMockNext,
  createMockRequest,
} from "../../mocks/express.mock";

type AsyncStub = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockCompanyDAO = { getIdByUuid: jest.fn() as AsyncStub };
const mockTenantDatabaseDAO = {
  getLiveByCompanyId: jest.fn() as AsyncStub,
  getBuildingByCompanyId: jest.fn() as AsyncStub,
  transition: jest.fn() as AsyncStub,
  getById: jest.fn() as AsyncStub,
};
const mockDbServerDAO = { getById: jest.fn() as AsyncStub };
const mockTenantStats = jest.fn();
const mockBeginProvisioning = jest.fn() as AsyncStub;
const mockRunProvisioningSteps = jest.fn() as AsyncStub;

jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function CompanyDAO() {
    return {
      getIdByUuid: (...args: unknown[]) => mockCompanyDAO.getIdByUuid(...args),
    };
  },
}));
jest.mock("../../../dao/tenant-database/tenant-database.dao", () => ({
  TenantDatabaseDAO: function TenantDatabaseDAO() {
    return {
      getLiveByCompanyId: (...args: unknown[]) =>
        mockTenantDatabaseDAO.getLiveByCompanyId(...args),
      getBuildingByCompanyId: (...args: unknown[]) =>
        mockTenantDatabaseDAO.getBuildingByCompanyId(...args),
      transition: (...args: unknown[]) =>
        mockTenantDatabaseDAO.transition(...args),
      getById: (...args: unknown[]) => mockTenantDatabaseDAO.getById(...args),
    };
  },
}));
jest.mock("../../../dao/db-server/db-server.dao", () => ({
  DbServerDAO: function DbServerDAO() {
    return {
      getById: (...args: unknown[]) => mockDbServerDAO.getById(...args),
    };
  },
}));
jest.mock("../../../database/tenant-pools", () => ({
  tenantStats: (...args: unknown[]) => mockTenantStats(...args),
}));
jest.mock("../../../services/tenant-provisioning.service", () => ({
  beginProvisioning: (...args: unknown[]) => mockBeginProvisioning(...args),
  runProvisioningSteps: (...args: unknown[]) =>
    mockRunProvisioningSteps(...args),
}));

import { TenantDatabaseController } from "../../../controllers/companies/tenant-database.controller";

const COMPANY_UUID = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const SERVER: any = {
  id: 9,
  uuid: "b1d4e6f8-0a2c-4e6f-9b1d-3e5f7a9c1e2b",
  name: "mobius-postgres (shared)",
  kind: "shared_container",
};
const ROW: any = {
  id: 42,
  uuid: "7c2e5f1a-9b3d-4e0f-8a71-2c6d9e5f1b04",
  companyId: 3,
  serverId: 9,
  databaseName: "tenant_3_acme_cajas",
  dbUser: "tenant_3_acme_cajas_user",
  credentialRef: "enc:v1",
  credentialCiphertext: Buffer.from("x"),
  status: "active",
  schemaVersion: "20260915000000_baseline.ts",
  migrationState: "current",
  lastMigrationAt: null,
  lastMigrationError: null,
  provisionedAt: new Date("2026-09-15T02:11:41.000Z"),
  suspendedAt: null,
  suspendReason: null,
  createdAt: new Date("2026-09-15T02:11:12.000Z"),
  updatedAt: new Date("2026-09-15T02:11:41.000Z"),
};

const reqFor = (body: unknown = {}): Request =>
  createMockRequest({ params: { uuid: COMPANY_UUID }, body }) as Request;

const FORBIDDEN_KEYS = [
  "id",
  "companyId",
  "serverId",
  "dbUser",
  "credentialRef",
  "credentialCiphertext",
  "adminUser",
  "adminCredentialRef",
  "host",
];

/** AC-58: a recursive scan finds none of the forbidden keys anywhere in `value`. */
const assertNoForbiddenKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(
      value as Record<string, unknown>,
    )) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
      assertNoForbiddenKeys(inner);
    }
  }
};

describe("TenantDatabaseController", () => {
  let controller: TenantDatabaseController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    mockCompanyDAO.getIdByUuid.mockReset();
    mockTenantDatabaseDAO.getLiveByCompanyId.mockReset();
    mockTenantDatabaseDAO.getBuildingByCompanyId.mockReset();
    mockTenantDatabaseDAO.transition.mockReset();
    mockTenantDatabaseDAO.getById.mockReset();
    mockDbServerDAO.getById.mockReset().mockResolvedValue(SERVER);
    mockTenantStats
      .mockReset()
      .mockReturnValue({ open: true, used: 1, free: 2, max: 3 });
    mockBeginProvisioning.mockReset();
    mockRunProvisioningSteps
      .mockReset()
      .mockResolvedValue({ ok: true, row: ROW });
    res = createMockResponse();
    next = createMockNext();
    controller = new TenantDatabaseController();
  });

  describe("getByCompany (AC-57)", () => {
    it("404s COMPANY_NOT_FOUND when the company does not exist", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(null);

      await controller.getByCompany(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, code: "COMPANY_NOT_FOUND" }),
      );
    });

    it("404s TENANT_DB_NOT_REGISTERED when the company has no row at all", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue(null);
      mockTenantDatabaseDAO.getBuildingByCompanyId.mockResolvedValue(null);

      await controller.getByCompany(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: "TENANT_DB_NOT_REGISTERED",
        }),
      );
    });

    it("returns exactly the model's key set, with pool from tenantStats", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue(ROW);

      await controller.getByCompany(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const body: any = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(Object.keys(body.data).sort()).toEqual(
        [
          "uuid",
          "status",
          "placement",
          "server",
          "databaseName",
          "schemaVersion",
          "migrationState",
          "lastMigrationAt",
          "lastMigrationError",
          "pool",
          "provisionedAt",
          "suspendedAt",
          "suspendReason",
          "createdAt",
          "updatedAt",
        ].sort(),
      );
      expect(body.data.pool).toEqual({ open: true, used: 1, free: 2, max: 3 });
      expect(body.data.placement).toBe("shared_container");
      assertNoForbiddenKeys(body);
    });
  });

  describe("provision (AC-59)", () => {
    it("404s COMPANY_NOT_FOUND when the company does not exist", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(null);

      await controller.provision(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("409s TENANT_DB_ALREADY_PROVISIONED for a live row", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockBeginProvisioning.mockResolvedValue({
        ok: false,
        code: "TENANT_DB_ALREADY_PROVISIONED",
        reason: "already active",
        row: ROW,
      });

      await controller.provision(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "TENANT_DB_ALREADY_PROVISIONED" }),
      );
    });

    it("409s SERVER_NOT_PROVISIONABLE for a server with no adminUser", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockBeginProvisioning.mockResolvedValue({
        ok: false,
        code: "SERVER_NOT_PROVISIONABLE",
        reason: "no adminUser",
        row: null,
      });

      await controller.provision(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SERVER_NOT_PROVISIONABLE" }),
      );
    });

    it("409s SERVER_NOT_ACCEPTING for a draining server", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockBeginProvisioning.mockResolvedValue({
        ok: false,
        code: "SERVER_NOT_ACCEPTING",
        reason: "draining",
        row: null,
      });

      await controller.provision(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SERVER_NOT_ACCEPTING" }),
      );
    });

    it("409s SERVER_MISMATCH when a retry names a server different from the row's pinned one (F2)", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockBeginProvisioning.mockResolvedValue({
        ok: false,
        code: "SERVER_MISMATCH",
        reason: "pinned to a different server",
        row: ROW,
      });

      await controller.provision(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SERVER_MISMATCH" }),
      );
    });

    it("202s with the row's real 'provisioning' status and fires the rest without awaiting it", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      const provisioningRow = { ...ROW, status: "provisioning" };
      mockBeginProvisioning.mockResolvedValue({
        ok: true,
        row: provisioningRow,
        server: SERVER,
        companyUuid: "company-uuid",
        needsRun: true,
      });
      let resolveRun: (v: unknown) => void = () => undefined;
      mockRunProvisioningSteps.mockReturnValue(
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
      );

      await controller.provision(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(202);
      const body: any = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.status).toBe("provisioning");
      // The handler returned without waiting on runProvisioningSteps's promise.
      expect(mockRunProvisioningSteps).toHaveBeenCalledWith(
        provisioningRow,
        SERVER,
        "company-uuid",
      );
      resolveRun({ ok: true, row: { ...ROW, status: "active" } });
    });
  });

  describe("suspend / resume (AC-60)", () => {
    it("400s when reason is missing", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);

      await controller.suspend(reqFor({}), res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(mockTenantDatabaseDAO.transition).not.toHaveBeenCalled();
    });

    it("400s when reason exceeds 500 characters", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);

      await controller.suspend(
        reqFor({ reason: "a".repeat(501) }),
        res as Response,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("suspends an active row and returns its tenant-database body", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue(ROW);
      mockTenantDatabaseDAO.transition.mockResolvedValue(1);
      mockTenantDatabaseDAO.getById.mockResolvedValue({
        ...ROW,
        status: "suspended",
        suspendReason: "maintenance",
      });

      await controller.suspend(
        reqFor({ reason: "maintenance" }),
        res as Response,
        next,
      );

      expect(mockTenantDatabaseDAO.transition).toHaveBeenCalledWith(
        ROW.id,
        "active",
        "suspended",
        { suspendReason: "maintenance" },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const body: any = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.status).toBe("suspended");
    });

    it("409s TENANT_STATUS_CONFLICT with the current status when the row is not active", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue({
        ...ROW,
        status: "provisioning",
      });

      await controller.suspend(
        reqFor({ reason: "maintenance" }),
        res as Response,
        next,
      );

      expect(mockTenantDatabaseDAO.transition).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "TENANT_STATUS_CONFLICT",
          data: { status: "provisioning" },
        }),
      );
    });

    it("resumes a suspended row", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue({
        ...ROW,
        status: "suspended",
      });
      mockTenantDatabaseDAO.transition.mockResolvedValue(1);
      mockTenantDatabaseDAO.getById.mockResolvedValue({
        ...ROW,
        status: "active",
      });

      await controller.resume(reqFor(), res as Response, next);

      expect(mockTenantDatabaseDAO.transition).toHaveBeenCalledWith(
        ROW.id,
        "suspended",
        "active",
        {},
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("409s TENANT_STATUS_CONFLICT on resume when the row is not suspended", async () => {
      mockCompanyDAO.getIdByUuid.mockResolvedValue(3);
      mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue({
        ...ROW,
        status: "active",
      });

      await controller.resume(reqFor(), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "TENANT_STATUS_CONFLICT",
          data: { status: "active" },
        }),
      );
    });
  });
});
