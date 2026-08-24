/**
 * `PUT /api/companies/:uuid/branding` — the write side of company-level
 * branding.
 *
 * What is pinned here:
 *  - WHOLESALE replacement (AC-4): the DAO always receives all five keys and an
 *    omitted key arrives as `null`. Nothing is merged with the previous value,
 *    because a merge makes "clear this field" unexpressible;
 *  - a DTO rejection becomes `req.statusCode = 400` + `next(err)` (AC-7) — the
 *    handler never throws out, so Express never sees an unhandled rejection;
 *  - the uuid→id hop uses `getIdByUuid` (L-005), so a real company can never
 *    404 because a mapper stripped its numeric id.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import {
  createMockResponse,
  createMockNext,
  createMockRequest,
} from "../../mocks/express.mock";

type AsyncStub = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockCompanyDAO = {
  getIdByUuid: jest.fn() as AsyncStub,
  updateBranding: jest.fn() as AsyncStub,
};
const mockAudit = {
  record: jest.fn() as AsyncStub,
};

jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function CompanyDAO() {
    return {
      getIdByUuid: (...args: unknown[]) => mockCompanyDAO.getIdByUuid(...args),
      updateBranding: (...args: unknown[]) =>
        mockCompanyDAO.updateBranding(...args),
    };
  },
}));
jest.mock("../../../dao/module/module.dao", () => ({
  ModuleDAO: function ModuleDAO() {
    return {};
  },
}));
jest.mock("../../../dao/company-module/company-module.dao", () => ({
  CompanyModuleDAO: function CompanyModuleDAO() {
    return {};
  },
}));
jest.mock("../../../dao/user/user.dao", () => ({
  UserDAO: function UserDAO() {
    return {};
  },
}));
jest.mock("../../../services/audit.service", () => ({
  AuditService: function AuditService() {
    return { record: (...args: unknown[]) => mockAudit.record(...args) };
  },
}));

import { CompaniesController } from "../../../controllers/companies/companies.controller";

const COMPANY_UUID = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const LOGO_UUID = "3f1a7c1e-4b2d-4a6e-9c1f-2b7d8e5a1c40";

const brandingRequest = (body: unknown): Request =>
  createMockRequest({ params: { uuid: COMPANY_UUID }, body }) as Request;

describe("CompaniesController.updateBranding", () => {
  let controller: CompaniesController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    mockCompanyDAO.getIdByUuid.mockReset();
    mockCompanyDAO.updateBranding.mockReset();
    mockAudit.record.mockReset();
    mockAudit.record.mockResolvedValue(undefined);
    res = createMockResponse();
    next = createMockNext();
    controller = new CompaniesController();
  });

  it("stores all five fields and answers with the saved company", async () => {
    mockCompanyDAO.getIdByUuid.mockResolvedValue(7);
    const saved = {
      uuid: COMPANY_UUID,
      name: "QA Demo Co",
      slug: "qa-demo-co",
      branding: {
        displayName: "QA Demo",
        brandColor: "#2563eb",
        accentColor: "#ffd400",
        logoFileUuid: LOGO_UUID,
        loginMessage: "Hola",
      },
    };
    mockCompanyDAO.updateBranding.mockResolvedValue(saved);

    await controller.updateBranding(
      brandingRequest({
        displayName: "QA Demo",
        brandColor: "#2563EB",
        accentColor: "#FFD400",
        logoFileUuid: LOGO_UUID,
        loginMessage: "Hola",
      }),
      res as Response,
      next,
    );

    expect(mockCompanyDAO.updateBranding).toHaveBeenCalledWith(7, {
      displayName: "QA Demo",
      // Lower-cased by the DTO.
      brandColor: "#2563eb",
      accentColor: "#ffd400",
      logoFileUuid: LOGO_UUID,
      loginMessage: "Hola",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: saved });
    expect(next).not.toHaveBeenCalled();
  });

  it("replaces wholesale: an omitted key is written as null, never merged (AC-4)", async () => {
    mockCompanyDAO.getIdByUuid.mockResolvedValue(7);
    mockCompanyDAO.updateBranding.mockResolvedValue({ uuid: COMPANY_UUID });

    await controller.updateBranding(
      brandingRequest({ brandColor: "#018445" }),
      res as Response,
      next,
    );

    expect(mockCompanyDAO.updateBranding).toHaveBeenCalledWith(7, {
      displayName: null,
      brandColor: "#018445",
      accentColor: null,
      logoFileUuid: null,
      loginMessage: null,
    });
  });

  it("records one audit entry for the company", async () => {
    mockCompanyDAO.getIdByUuid.mockResolvedValue(7);
    mockCompanyDAO.updateBranding.mockResolvedValue({
      uuid: COMPANY_UUID,
      name: "QA Demo Co",
      branding: { displayName: "QA Demo" },
    });

    await controller.updateBranding(
      brandingRequest({ displayName: "QA Demo" }),
      res as Response,
      next,
    );

    expect(mockAudit.record).toHaveBeenCalledTimes(1);
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.anything(),
      "Company",
      "Modificacion",
      expect.objectContaining({ uuid: COMPANY_UUID, companyId: 7 }),
    );
  });

  it("404s for an unknown company without writing anything", async () => {
    mockCompanyDAO.getIdByUuid.mockResolvedValue(null);

    await controller.updateBranding(
      brandingRequest({ displayName: "Nope" }),
      res as Response,
      next,
    );

    expect(mockCompanyDAO.updateBranding).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Company not found",
    });
  });

  it("turns an invalid payload into a 400 and never writes (AC-6/AC-7)", async () => {
    mockCompanyDAO.getIdByUuid.mockResolvedValue(7);

    const invalidBodies = [
      { displayName: "a".repeat(81) },
      { loginMessage: "b".repeat(161) },
      { brandColor: "red" },
      { accentColor: "#12345" },
      { logoFileUuid: "not-a-uuid" },
    ];

    for (const body of invalidBodies) {
      const req = brandingRequest(body);
      const localNext = createMockNext();

      await controller.updateBranding(req, res as Response, localNext);

      expect(req.statusCode).toBe(400);
      expect(localNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockCompanyDAO.updateBranding).not.toHaveBeenCalled();
      expect(mockAudit.record).not.toHaveBeenCalled();
    }
  });

  it("forwards a DAO failure to the error middleware instead of throwing", async () => {
    const error = new Error("Database error");
    mockCompanyDAO.getIdByUuid.mockResolvedValue(7);
    mockCompanyDAO.updateBranding.mockRejectedValue(error);

    await expect(
      controller.updateBranding(
        brandingRequest({ displayName: "QA Demo" }),
        res as Response,
        next,
      ),
    ).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledWith(error);
  });
});
