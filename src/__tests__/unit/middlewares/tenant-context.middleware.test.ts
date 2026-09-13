/**
 * `resolveTenantContext` must pick exactly the company `getCompanyScope` picks
 * (I-9, L-009) — the middleware promotes that precedence, it never re-derives
 * it. Every case computes the expectation from `getCompanyScope(req)` itself, so
 * a precedence drift in either place turns a case red.
 *
 * The load-bearing case is the member who names another company: resolving
 * `?companyId` or `body.companyId` for a non-superAdmin is the cross-tenant
 * leak this whole path exists to prevent.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import {
  createMockRequest,
  createMockResponse,
} from "../../mocks/express.mock";

const COMPANY_A = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const COMPANY_B = "9c8b7a65-4321-4f0e-9d1c-2b3a4c5d6e7f";
const DELETED_COMPANY = "11111111-2222-4333-8444-555555555555";
const IDS: Record<string, number> = { [COMPANY_A]: 7, [COMPANY_B]: 9 };

const getIdByUuid = jest.fn<(uuid: string) => Promise<number | null>>();

jest.mock("../../../dao/company/company.dao", () => ({
  CompanyDAO: function CompanyDAO() {
    return { getIdByUuid: (uuid: string) => getIdByUuid(uuid) };
  },
}));

import {
  resolveTenantContext,
  tenantContext,
} from "../../../middlewares/tenant-context.middleware";
import { getCompanyScope } from "../../../utils/companyScope";
import {
  getRequestContext,
  type RequestContext,
} from "../../../utils/requestContext";

type Role = "member" | "admin" | "superAdmin";

const requestAs = (
  role: Role,
  options: {
    tokenCompany?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
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
  } as Partial<Request>) as Request;

type Outcome = {
  proceeded: boolean;
  context: RequestContext | undefined;
  res: Response;
};

/** Mounts both halves the way the app does: app-level scope, then `authenticate`. */
const resolve = (req: Request): Promise<Outcome> => {
  const res = createMockResponse() as Response;
  return new Promise((done, fail) => {
    const next: NextFunction = () => {
      resolveTenantContext(req, res)
        .then(async (proceeded) => {
          // Read after an await: the context must survive async continuations.
          await new Promise((tick) => setImmediate(tick));
          done({ proceeded, context: getRequestContext(), res });
        })
        .catch(fail);
    };
    tenantContext(req, res, next);
  });
};

const expectedIdFor = (req: Request): number | undefined => {
  const { companyUuid } = getCompanyScope(req);
  return companyUuid ? IDS[companyUuid] : undefined;
};

// jest.config has resetMocks: true, which drops implementations between tests.
beforeEach(() => {
  getIdByUuid.mockImplementation(async (uuid) => IDS[uuid] ?? null);
});

describe("resolveTenantContext — parity with getCompanyScope (AC-5)", () => {
  it("a user resolves the company in their token", async () => {
    const req = requestAs("member", { tokenCompany: COMPANY_A });

    const { proceeded, context } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(req.companyId).toBe(expectedIdFor(req));
    expect(req.companyId).toBe(7);
    expect(context).toMatchObject({
      companyId: 7,
      companyUuid: COMPANY_A,
      isSuperAdmin: false,
    });
  });

  it("a user naming another company in query or body still resolves their token's company", async () => {
    const req = requestAs("admin", {
      tokenCompany: COMPANY_A,
      query: { companyId: COMPANY_B },
      body: { companyId: COMPANY_B },
    });

    const { proceeded, context } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(req.companyId).toBe(expectedIdFor(req));
    expect(req.companyId).toBe(7);
    expect(context?.companyUuid).toBe(COMPANY_A);
    expect(getIdByUuid).not.toHaveBeenCalledWith(COMPANY_B);
  });

  it("a superAdmin with ?companyId resolves the selected company", async () => {
    const req = requestAs("superAdmin", { query: { companyId: COMPANY_B } });

    const { proceeded, context } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(req.companyId).toBe(expectedIdFor(req));
    expect(req.companyId).toBe(9);
    expect(context).toMatchObject({
      companyId: 9,
      companyUuid: COMPANY_B,
      isSuperAdmin: true,
    });
    expect(getIdByUuid).toHaveBeenCalledTimes(1);
  });

  it("a superAdmin without a company resolves none and looks nothing up", async () => {
    const req = requestAs("superAdmin");

    const { proceeded, context } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(expectedIdFor(req)).toBeUndefined();
    expect(req.companyId).toBeUndefined();
    expect(context?.companyId).toBeUndefined();
    expect(context?.companyUuid).toBeUndefined();
    expect(context?.isSuperAdmin).toBe(true);
    expect(getIdByUuid).not.toHaveBeenCalled();
  });

  it("a superAdmin operating as a company through body.companyId resolves that company", async () => {
    const req = requestAs("superAdmin", { body: { companyId: COMPANY_B } });

    const { proceeded } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(req.companyId).toBe(expectedIdFor(req));
    expect(req.companyId).toBe(9);
  });

  it("a superAdmin's ?companyId wins over body.companyId", async () => {
    const req = requestAs("superAdmin", {
      query: { companyId: COMPANY_A },
      body: { companyId: COMPANY_B },
    });

    await resolve(req);

    expect(req.companyId).toBe(expectedIdFor(req));
    expect(req.companyId).toBe(7);
  });
});

describe("resolveTenantContext — a stale company selection", () => {
  const NOT_FOUND =
    '{"success":false,"code":"COMPANY_NOT_FOUND","message":"The selected company no longer exists."}';

  it("answers 404 COMPANY_NOT_FOUND when a superAdmin selects a deleted company", async () => {
    const req = requestAs("superAdmin", {
      query: { companyId: DELETED_COMPANY },
    });

    const { proceeded, res } = await resolve(req);

    expect(proceeded).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(body)).toBe(NOT_FOUND);
    expect(req.companyId).toBeUndefined();
  });

  it("answers 404 without a lookup when the selection is not a uuid", async () => {
    const req = requestAs("superAdmin", { query: { companyId: "not-a-uuid" } });

    const { proceeded, res } = await resolve(req);

    expect(proceeded).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(getIdByUuid).not.toHaveBeenCalled();
  });

  it("does not answer for a member whose token company does not resolve; the id stays unset", async () => {
    const req = requestAs("member", { tokenCompany: DELETED_COMPANY });

    const { proceeded, context, res } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.companyId).toBeUndefined();
    expect(context?.companyUuid).toBeUndefined();
  });
});

describe("tenantContext — the per-request scope", () => {
  it("gives an unauthenticated request a context with no company", async () => {
    const req = createMockRequest() as Request;
    const res = createMockResponse() as Response;

    const context = await new Promise<RequestContext | undefined>((done) => {
      tenantContext(req, res, () => {
        setImmediate(() => done(getRequestContext()));
      });
    });

    expect(context).toEqual({ isSuperAdmin: false, coreCache: new Map() });
  });

  it("never shares a context between two concurrent requests", async () => {
    const first = requestAs("member", { tokenCompany: COMPANY_A });
    const second = requestAs("member", { tokenCompany: COMPANY_B });

    const [a, b] = await Promise.all([resolve(first), resolve(second)]);

    expect(a.context?.companyId).toBe(7);
    expect(b.context?.companyId).toBe(9);
    expect(a.context?.coreCache).not.toBe(b.context?.coreCache);
  });
});
