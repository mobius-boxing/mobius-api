/**
 * `resolveTenantContext` must pick exactly the company `getCompanyScope` picks
 * (I-9, L-009) — the middleware promotes that precedence, it never re-derives
 * it. Every case computes the expectation from `getCompanyScope(req)` itself, so
 * a precedence drift in either place turns a case red.
 *
 * The load-bearing case is the member who names another company: resolving
 * `?companyId` or `body.companyId` for a non-superAdmin is the cross-tenant
 * leak this whole path exists to prevent.
 *
 * db-per-company T7 adds the route-plane gate (AC-42, AC-92) and tenant
 * acquisition. The company lookup now goes through `CoreClient.companyIdByUuid`
 * instead of a bare `CompanyDAO` (T2 review note) — the mock moved with it,
 * old seam `CompanyDAO.getIdByUuid` → new seam `CoreClient.companyIdByUuid`,
 * same behaviour, same assertions.
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

const companyIdByUuid = jest.fn<(uuid: string) => Promise<number | null>>();

jest.mock("../../../services/core-client.service", () => ({
  CoreClient: { companyIdByUuid: (uuid: string) => companyIdByUuid(uuid) },
  CoreUnavailableError: class CoreUnavailableError extends Error {},
}));

const acquireTenant =
  jest.fn<
    (
      companyId: number,
    ) => Promise<import("../../../database/tenant-pools").TenantResolution>
  >();

jest.mock("../../../database/tenant-pools", () => {
  const actual = jest.requireActual("../../../database/tenant-pools") as object;
  return {
    ...actual,
    acquireTenant: (companyId: number) => acquireTenant(companyId),
  };
});

import {
  ROUTE_PLANE,
  resolveTenantContext,
  tenantContext,
} from "../../../middlewares/tenant-context.middleware";
import { getCompanyScope } from "../../../utils/companyScope";
import {
  getRequestContext,
  type RequestContext,
} from "../../../utils/requestContext";
import { COMPANY_REQUIRED_BODY } from "../../../database/tenant-pools";
import type { TenantHandle } from "../../../database/tenant-pools";

type Role = "member" | "admin" | "superAdmin";

const requestAs = (
  role: Role,
  options: {
    tokenCompany?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    baseUrl?: string;
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
    baseUrl: options.baseUrl,
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

const HANDLE: TenantHandle = {
  physicalKey: "core",
  tenantDatabaseId: 1,
  companyId: 7,
  companyUuid: "",
  serverId: 1,
  instance: {} as never,
  guarded: {} as never,
  openedAt: 0,
  lastUsedAt: 0,
};

// jest.config has resetMocks: true, which drops implementations between tests.
beforeEach(() => {
  companyIdByUuid.mockImplementation(async (uuid) => IDS[uuid] ?? null);
  acquireTenant.mockResolvedValue({ kind: "ok", handle: { ...HANDLE } });
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
    expect(companyIdByUuid).not.toHaveBeenCalledWith(COMPANY_B);
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
    expect(companyIdByUuid).toHaveBeenCalledTimes(1);
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
    expect(companyIdByUuid).not.toHaveBeenCalled();
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
    expect(companyIdByUuid).not.toHaveBeenCalled();
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

describe("resolveTenantContext — route-plane gate (db-per-company T7, AC-42, AC-92)", () => {
  const COMPANY_REQUIRED =
    '{"success":false,"code":"COMPANY_REQUIRED","message":"This resource is company-scoped; superAdmins must specify companyId."}';

  it.each<Role>(["member", "admin"])(
    "a NULL-company %s gets 400 COMPANY_REQUIRED on a tenant route, before any acquisition",
    async (role) => {
      const req = requestAs(role, { baseUrl: "/api/customer" });

      const { proceeded, res } = await resolve(req);

      expect(proceeded).toBe(false);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(body)).toBe(COMPANY_REQUIRED);
      expect(acquireTenant).not.toHaveBeenCalled();
    },
  );

  it("a superAdmin with no selected company gets 400 COMPANY_REQUIRED on a tenant route (AC-42)", async () => {
    const req = requestAs("superAdmin", { baseUrl: "/api/customer" });

    const { proceeded, res } = await resolve(req);

    expect(proceeded).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).toBe(
      COMPANY_REQUIRED,
    );
    expect(acquireTenant).not.toHaveBeenCalled();
  });

  it("a NULL-company superAdmin still proceeds on a central route (AC-42)", async () => {
    const req = requestAs("superAdmin", { baseUrl: "/api/companies" });

    const { proceeded, res } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(acquireTenant).not.toHaveBeenCalled();
  });

  it("a NULL-company admin still proceeds on a central route (AC-42)", async () => {
    const req = requestAs("admin", { baseUrl: "/api/users" });

    const { proceeded, res } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(acquireTenant).not.toHaveBeenCalled();
  });

  it("a NULL-company user proceeds unscoped on a mixed route (D-61), and never acquires", async () => {
    const req = requestAs("admin", { baseUrl: "/api/audit-logs" });

    const { proceeded, res } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(acquireTenant).not.toHaveBeenCalled();
  });

  it("a mixed route DOES acquire once a company is selected", async () => {
    const req = requestAs("superAdmin", {
      baseUrl: "/api/audit-logs",
      query: { companyId: COMPANY_A },
    });

    const { proceeded } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(acquireTenant).toHaveBeenCalledWith(7);
  });

  it("mutation check: treating a NULL company as unscoped on a tenant route must fail", () => {
    // `ROUTE_PLANE` must classify a business route as `tenant`, not `central` —
    // reverting `customer` to `central` here would silently widen AC-92's gate
    // back to today's pre-existing gap (D-93).
    expect(ROUTE_PLANE["customer"]).toBe("tenant");
    expect(ROUTE_PLANE["companies"]).toBe("central");
    expect(ROUTE_PLANE["audit-logs"]).toBe("mixed");
  });
});

describe("resolveTenantContext — tenant acquisition (db-per-company T7)", () => {
  const TENANT_ROUTE = { baseUrl: "/api/customer", tokenCompany: COMPANY_A };

  it("a non-superAdmin naming company B on a tenant route still acquires A's handle (AC-40)", async () => {
    const req = requestAs("member", {
      baseUrl: "/api/customer",
      tokenCompany: COMPANY_A,
      query: { companyId: COMPANY_B },
      body: { companyId: COMPANY_B },
    });

    const { proceeded } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(acquireTenant).toHaveBeenCalledWith(7); // COMPANY_A's id
    expect(acquireTenant).not.toHaveBeenCalledWith(9); // COMPANY_B's id
  });

  it("an 'ok' resolution sets context.tenant and lets the request through", async () => {
    const req = requestAs("member", TENANT_ROUTE);

    const { proceeded, context } = await resolve(req);

    expect(proceeded).toBe(true);
    expect(acquireTenant).toHaveBeenCalledWith(7);
    expect(context?.tenant).toMatchObject({
      physicalKey: "core",
      tenantDatabaseId: 1,
      companyUuid: COMPANY_A,
    });
  });

  it.each([
    ["provisioning", 503, "TENANT_DB_PROVISIONING", "15"],
    ["unavailable", 503, "TENANT_DB_UNAVAILABLE", undefined],
    ["suspended", 403, "TENANT_SUSPENDED", undefined],
    ["behind", 503, "TENANT_DB_BEHIND", undefined],
    ["busy", 503, "TENANT_DB_BUSY", "2"],
  ] as const)(
    "maps resolution kind %s to %i %s (AC-43)",
    async (kind, status, code, retryAfter) => {
      acquireTenant.mockResolvedValue({ kind, row: null });
      const req = requestAs("member", TENANT_ROUTE);

      const { proceeded, res } = await resolve(req);

      expect(proceeded).toBe(false);
      expect(res.status).toHaveBeenCalledWith(status);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body).toMatchObject({ success: false, code });
      if (retryAfter) {
        expect(res.set).toHaveBeenCalledWith("Retry-After", retryAfter);
      } else {
        expect(res.set).not.toHaveBeenCalled();
      }
    },
  );
});

describe("resolveTenantContext — the company lookup goes through CoreClient (T2 review note)", () => {
  it("propagates a CoreUnavailableError from the lookup as a rejection (503 via the error middleware)", async () => {
    const { CoreUnavailableError } = jest.requireMock(
      "../../../services/core-client.service",
    ) as { CoreUnavailableError: new () => Error };
    companyIdByUuid.mockRejectedValue(new CoreUnavailableError());
    const req = requestAs("member", { tokenCompany: COMPANY_A });
    const res = createMockResponse() as Response;

    // `authenticate`'s own try/catch is what turns this into `next(error)`;
    // this test only proves the lookup itself is NOT swallowed here.
    await expect(resolveTenantContext(req, res)).rejects.toBeInstanceOf(
      CoreUnavailableError,
    );
  });

  it("mutation check: reverting to a direct DAO lookup would break this seam silently", () => {
    // `companyIdByUuid` is the ONLY mocked seam in this file; if the source
    // reverted to `new CompanyDAO().getIdByUuid`, every case above would call
    // the REAL DAO (no `database/registry` connection in this suite) and
    // throw `DatabaseNotConnectedError` instead of resolving — the whole file
    // would go red before this assertion is ever reached, not silently pass.
    expect(companyIdByUuid).toBeDefined();
    expect(COMPANY_REQUIRED_BODY.code).toBe("COMPANY_REQUIRED");
  });
});
