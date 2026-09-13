/**
 * `requireModule` reads the company `authenticate` already resolved
 * (`req.companyId`) instead of resolving it again (AC-6). Its three refusals are
 * a contract the module SPAs parse, so the bodies are compared as serialized
 * bytes, not as loose object matches.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import {
  createMockRequest,
  createMockResponse,
} from "../../mocks/express.mock";

const isEnabled = jest.fn(
  async (_companyId: number, _slug: string): Promise<boolean> => false,
);
const getIdByUuid = jest.fn(async (_uuid: string): Promise<number | null> => 7);

jest.mock("../../../dao/company-module/company-module.dao", () => ({
  CompanyModuleDAO: function CompanyModuleDAO() {
    return {
      isEnabled: (companyId: number, slug: string) =>
        isEnabled(companyId, slug),
    };
  },
}));

jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function CompanyDAO() {
    return { getIdByUuid: (uuid: string) => getIdByUuid(uuid) };
  },
}));

import { requireModule } from "../../../middlewares/module.middleware";

const COMPANY_A = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const COMPANY_B = "9c8b7a65-4321-4f0e-9d1c-2b3a4c5d6e7f";

type Role = "member" | "admin" | "superAdmin";

const requestAs = (
  role: Role,
  options: {
    tokenCompany?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    companyId?: number;
  } = {},
): Request =>
  createMockRequest({
    user: {
      userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      email: "someone@acme.test",
      role,
      companyId: options.tokenCompany,
    },
    query: options.query ?? {},
    body: options.body ?? {},
    companyId: options.companyId,
  } as Partial<Request>) as Request;

const run = async (req: Request) => {
  const res = createMockResponse() as Response;
  const next = jest.fn() as unknown as NextFunction;
  await requireModule("countdown")(req, res, next);
  const json = (res.json as jest.Mock).mock.calls[0]?.[0];
  return {
    res,
    next,
    body: json === undefined ? undefined : JSON.stringify(json),
  };
};

beforeEach(() => {
  isEnabled.mockReset();
  isEnabled.mockResolvedValue(false);
  getIdByUuid.mockClear();
});

describe("requireModule (AC-6)", () => {
  it("400s a superAdmin with no company, byte-identical", async () => {
    const { res, next, body } = await run(requestAs("superAdmin"));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(body).toBe(
      '{"success":false,"message":"SuperAdmin must specify a company (companyId)."}',
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("400s a user without a company, byte-identical", async () => {
    const { res, next, body } = await run(requestAs("member"));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(body).toBe(
      '{"success":false,"message":"User must belong to a company."}',
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("404s when a company was named but did not resolve, byte-identical", async () => {
    const { res, next, body } = await run(
      requestAs("superAdmin", { body: { companyId: COMPANY_B } }),
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(body).toBe('{"success":false,"message":"Company not found."}');
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when the module is not enabled, byte-identical", async () => {
    const { res, next, body } = await run(
      requestAs("member", { tokenCompany: COMPANY_A, companyId: 7 }),
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(body).toBe(
      '{"success":false,"message":"The \'countdown\' module is not enabled for this company."}',
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when the module is enabled for the resolved company", async () => {
    isEnabled.mockResolvedValue(true);

    const { res, next } = await run(
      requestAs("superAdmin", {
        query: { companyId: COMPANY_B },
        companyId: 9,
      }),
    );

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(isEnabled).toHaveBeenCalledWith(9, "countdown");
  });

  it("gates on req.companyId, never on a company the user names", async () => {
    isEnabled.mockResolvedValue(true);

    await run(
      requestAs("admin", {
        tokenCompany: COMPANY_A,
        query: { companyId: COMPANY_B },
        companyId: 7,
      }),
    );

    expect(isEnabled).toHaveBeenCalledWith(7, "countdown");
  });

  it("never resolves the company itself", async () => {
    isEnabled.mockResolvedValue(true);

    await run(requestAs("member"));
    await run(requestAs("superAdmin", { body: { companyId: COMPANY_B } }));
    await run(requestAs("member", { tokenCompany: COMPANY_A, companyId: 7 }));
    await run(
      requestAs("superAdmin", {
        query: { companyId: COMPANY_B },
        companyId: 9,
      }),
    );

    expect(getIdByUuid).toHaveBeenCalledTimes(0);
  });
});
