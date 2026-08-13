/**
 * The public, unauthenticated whitelabel endpoint.
 *
 * Two things are pinned here because the deployed customer SPA depends on them
 * and is NOT redeployed with this change:
 *  - the response keys and their fallbacks (`company.name`, `#018445`);
 *  - the generic 404 whenever the module is not enabled for that company —
 *    `getEnabledConfig` stays the gate even though its payload is no longer
 *    read (spec Non-goal: "no change to the public endpoint's route shape").
 * What DOES change is the source: branding now comes from `companies.branding`.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import {
  createMockResponse,
  createMockNext,
  createMockRequest,
} from "../../mocks/express.mock";

/** Async DAO stub: the return type stays `unknown` so a test can hand it junk. */
type AsyncStub = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockCompanyDAO = {
  getBySlug: jest.fn() as AsyncStub,
};
const mockCompanyModuleDAO = {
  getEnabledConfig: jest.fn() as AsyncStub,
};
const mockFileDAO = {
  getByUuid: jest.fn() as AsyncStub,
};

jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function CompanyDAO() {
    return {
      getBySlug: (...args: unknown[]) => mockCompanyDAO.getBySlug(...args),
    };
  },
}));

jest.mock("../../../dao/company-module/company-module.dao", () => ({
  CompanyModuleDAO: function CompanyModuleDAO() {
    return {
      getEnabledConfig: (...args: unknown[]) =>
        mockCompanyModuleDAO.getEnabledConfig(...args),
    };
  },
}));

jest.mock("../../../dao/file/file.dao", () => ({
  FileDAO: function FileDAO() {
    return {
      getByUuid: (...args: unknown[]) => mockFileDAO.getByUuid(...args),
    };
  },
}));

jest.mock("../../../services/file-storage.service", () => ({
  FileStorageService: function FileStorageService() {
    return {
      getDownloadUrl: async () => null,
      localObjectExists: async () => false,
      getLocalReadStream: () => ({ pipe: () => undefined }),
    };
  },
}));

import { WhitelabelController } from "../../../controllers/public/whitelabel.controller";

const LOGO_UUID = "3f1a7c1e-4b2d-4a6e-9c1f-2b7d8e5a1c40";

const company = (branding: unknown) => ({
  id: 7,
  uuid: "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60",
  name: "QA Demo Co",
  slug: "qa-demo-co",
  isActive: true,
  branding,
});

const brandingRequest = (): Request =>
  createMockRequest({
    params: { module: "countdown", client: "qa-demo-co" },
  }) as Request;

describe("WhitelabelController.getBranding", () => {
  let controller: WhitelabelController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    mockCompanyDAO.getBySlug.mockReset();
    mockCompanyModuleDAO.getEnabledConfig.mockReset();
    mockFileDAO.getByUuid.mockReset();
    res = createMockResponse();
    next = createMockNext();
    controller = new WhitelabelController();
  });

  it("serves the branding stored on the COMPANY, not on the module config", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(
      company({
        displayName: "QA Demo",
        brandColor: "#2563eb",
        loginMessage: "Portal de vencimientos de QA Demo.",
      }),
    );
    // The legacy per-module blob still exists and must be ignored.
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue({
      countdown: { branding: { displayName: "Stale", brandColor: "#ff0000" } },
    });

    await controller.getBranding(brandingRequest(), res as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        companyUuid: "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60",
        slug: "qa-demo-co",
        displayName: "QA Demo",
        brandColor: "#2563eb",
        logoUrl: null,
        loginMessage: "Portal de vencimientos de QA Demo.",
      },
    });
  });

  it("falls back to the company name and the default colour when branding is empty", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(company({}));
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue({});

    await controller.getBranding(brandingRequest(), res as Response, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        displayName: "QA Demo Co",
        brandColor: "#018445",
        logoUrl: null,
        loginMessage: null,
      }),
    });
  });

  it("returns an absolute logo URL only when a logo is set", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(
      company({ logoFileUuid: LOGO_UUID }),
    );
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue({});

    await controller.getBranding(brandingRequest(), res as Response, next);

    const payload = (res.json as jest.Mock).mock.calls[0][0] as {
      data: { logoUrl: string };
    };
    expect(payload.data.logoUrl).toMatch(
      /^https?:\/\/.+\/api\/public\/whitelabel\/countdown\/qa-demo-co\/logo$/,
    );
  });

  it("404s when the module is not enabled for that company", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(
      company({ displayName: "QA Demo" }),
    );
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue(null);

    await controller.getBranding(brandingRequest(), res as Response, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Not found",
    });
  });

  it("404s for an unknown client without querying the module link", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(null);

    await controller.getBranding(brandingRequest(), res as Response, next);

    expect(mockCompanyModuleDAO.getEnabledConfig).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s on a junk slug before it reaches a query", async () => {
    const req = createMockRequest({
      params: { module: "countdown", client: "../etc/passwd" },
    }) as Request;

    await controller.getBranding(req, res as Response, next);

    expect(mockCompanyDAO.getBySlug).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("never 500s on a malformed branding blob", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(company("not-an-object"));
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue({});

    await controller.getBranding(brandingRequest(), res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        displayName: "QA Demo Co",
        brandColor: "#018445",
      }),
    });
  });
});

describe("WhitelabelController.getLogo", () => {
  let controller: WhitelabelController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    mockCompanyDAO.getBySlug.mockReset();
    mockCompanyModuleDAO.getEnabledConfig.mockReset();
    mockFileDAO.getByUuid.mockReset();
    res = createMockResponse();
    next = createMockNext();
    controller = new WhitelabelController();
  });

  it("looks the file up by the COMPANY's own logo uuid, scoped to that company", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(
      company({ logoFileUuid: LOGO_UUID }),
    );
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue({});
    mockFileDAO.getByUuid.mockResolvedValue(null);

    await controller.getLogo(brandingRequest(), res as Response, next);

    expect(mockFileDAO.getByUuid).toHaveBeenCalledWith(
      LOGO_UUID,
      "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60",
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s when the company has no logo", async () => {
    mockCompanyDAO.getBySlug.mockResolvedValue(company({}));
    mockCompanyModuleDAO.getEnabledConfig.mockResolvedValue({});

    await controller.getLogo(brandingRequest(), res as Response, next);

    expect(mockFileDAO.getByUuid).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
