import { jest, describe, it, expect, beforeEach } from "@jest/globals";

type AsyncStub = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockTenantDatabaseDAO = {
  getLiveByCompanyId: jest.fn() as AsyncStub,
  getBuildingByCompanyId: jest.fn() as AsyncStub,
  transition: jest.fn() as AsyncStub,
  getById: jest.fn() as AsyncStub,
  create: jest.fn() as AsyncStub,
};
const mockDbServerDAO = {
  getById: jest.fn() as AsyncStub,
  getByUuid: jest.fn() as AsyncStub,
  getDefaultPlacement: jest.fn() as AsyncStub,
};
const mockCompanyDAO = { getById: jest.fn() as AsyncStub };

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
      create: (...args: unknown[]) => mockTenantDatabaseDAO.create(...args),
    };
  },
}));
jest.mock("../../../dao/db-server/db-server.dao", () => ({
  DbServerDAO: function DbServerDAO() {
    return {
      getById: (...args: unknown[]) => mockDbServerDAO.getById(...args),
      getByUuid: (...args: unknown[]) => mockDbServerDAO.getByUuid(...args),
      getDefaultPlacement: (...args: unknown[]) =>
        mockDbServerDAO.getDefaultPlacement(...args),
    };
  },
}));
jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function CompanyDAO() {
    return {
      getById: (...args: unknown[]) => mockCompanyDAO.getById(...args),
    };
  },
}));

import {
  beginProvisioning,
  computeTenantNaming,
  TENANT_SLUG_MAX_LENGTH,
} from "../../../services/tenant-provisioning.service";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

describe("computeTenantNaming — D-25 naming, brief AC-52", () => {
  it.each([
    [3, "rol-pel-srl", "tenant_3_rol_pel_srl"],
    [6, "corrugadora-rio-negro-srl", "tenant_6_corrugadora_rio_negro_srl"],
    [15, "qa-demo-co", "tenant_15_qa_demo_co"],
  ])("company %i, slug %j -> %j", (companyId, slug, expectedDatabaseName) => {
    const naming = computeTenantNaming(companyId, slug);
    expect(naming.databaseName).toBe(expectedDatabaseName);
    expect(naming.dbUser).toBe(`${expectedDatabaseName}_user`);
  });

  it("cuts a 60-char slug to 40, and both names stay under 63 chars and match the CHECK regex", () => {
    const slug = "a".repeat(60);
    const naming = computeTenantNaming(999, slug);
    const convertedSlug = naming.databaseName.replace(`tenant_999_`, "");
    expect(convertedSlug.length).toBe(TENANT_SLUG_MAX_LENGTH);
    expect(naming.databaseName.length).toBeLessThanOrEqual(63);
    expect(naming.dbUser.length).toBeLessThanOrEqual(63);
    expect(naming.databaseName).toMatch(IDENTIFIER);
    expect(naming.dbUser).toMatch(IDENTIFIER);
  });

  it("strips a trailing underscore exposed by the 40-char cut", () => {
    // 40 "a"s then a hyphen: the cut lands exactly on the hyphen-turned-underscore.
    const slug = `${"a".repeat(39)}-rest-of-the-name`;
    const naming = computeTenantNaming(1, slug);
    expect(naming.databaseName.endsWith("_")).toBe(false);
    expect(naming.databaseName).toMatch(IDENTIFIER);
  });

  it("is deterministic", () => {
    expect(computeTenantNaming(3, "rol-pel-srl")).toStrictEqual(
      computeTenantNaming(3, "rol-pel-srl"),
    );
  });
});

describe("beginProvisioning — F2 cross-server retry refusal", () => {
  const FAILED_ROW: any = {
    id: 42,
    companyId: 7,
    serverId: 1,
    status: "failed",
    databaseName: "tenant_7_acme",
    dbUser: "tenant_7_acme_user",
    credentialRef: "sealed:x",
    credentialCiphertext: null,
  };
  const ORIGINAL_SERVER: any = {
    id: 1,
    uuid: "server-1-uuid",
    name: "server-1",
    status: "active",
    adminUser: "admin",
  };
  const OTHER_SERVER: any = { id: 2, uuid: "server-2-uuid", name: "server-2" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantDatabaseDAO.getLiveByCompanyId.mockResolvedValue(null);
    mockTenantDatabaseDAO.getBuildingByCompanyId.mockResolvedValue(FAILED_ROW);
  });

  it("refuses with SERVER_MISMATCH and leaves the row untouched when the retry names a different server", async () => {
    mockDbServerDAO.getByUuid.mockResolvedValue(OTHER_SERVER);

    const result = await beginProvisioning(FAILED_ROW.companyId, {
      serverUuid: OTHER_SERVER.uuid,
    });

    expect(result).toStrictEqual({
      ok: false,
      code: "SERVER_MISMATCH",
      reason: expect.stringContaining("SERVER_MISMATCH"),
      row: FAILED_ROW,
    });
    expect(mockTenantDatabaseDAO.transition).not.toHaveBeenCalled();
    expect(mockTenantDatabaseDAO.create).not.toHaveBeenCalled();
  });

  it("resumes normally when the retry names the row's own server", async () => {
    mockDbServerDAO.getByUuid.mockResolvedValue(ORIGINAL_SERVER);
    mockDbServerDAO.getById.mockResolvedValue(ORIGINAL_SERVER);
    mockTenantDatabaseDAO.transition.mockResolvedValue(1);
    mockTenantDatabaseDAO.getById.mockResolvedValue({
      ...FAILED_ROW,
      status: "provisioning",
    });
    mockCompanyDAO.getById.mockResolvedValue({
      id: FAILED_ROW.companyId,
      uuid: "company-uuid",
      slug: "acme",
    });

    const result = await beginProvisioning(FAILED_ROW.companyId, {
      serverUuid: ORIGINAL_SERVER.uuid,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.status).toBe("provisioning");
    expect(result.server).toStrictEqual(ORIGINAL_SERVER);
    expect(mockTenantDatabaseDAO.transition).toHaveBeenCalledWith(
      FAILED_ROW.id,
      "failed",
      "provisioning",
    );
  });

  it("still answers SERVER_NOT_FOUND when the requested serverUuid resolves to nothing, even mid-retry", async () => {
    mockDbServerDAO.getByUuid.mockResolvedValue(null);

    const result = await beginProvisioning(FAILED_ROW.companyId, {
      serverUuid: "nonexistent-uuid",
    });

    expect(result).toStrictEqual({
      ok: false,
      code: "SERVER_NOT_FOUND",
      reason: expect.stringContaining("SERVER_NOT_FOUND"),
      row: null,
    });
  });
});
