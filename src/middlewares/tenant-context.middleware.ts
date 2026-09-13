import type { NextFunction, Request, Response } from "express";
import { CompanyDAO } from "../dao/company/company.dao";
import { getCompanyScope } from "../utils/companyScope";
import { getRequestContext, runWithContext } from "../utils/requestContext";

/** RFC 4122 shape only — a malformed uuid would make Postgres throw, not answer. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPANY_NOT_FOUND_BODY = {
  success: false,
  code: "COMPANY_NOT_FOUND",
  message: "The selected company no longer exists.",
} as const;

/**
 * Opens the per-request context every request runs in. It cannot resolve the
 * company itself: `authenticate` is mounted inside each router, so `req.user`
 * does not exist yet at app level. `resolveTenantContext` fills this context in
 * once `authenticate` has set the user.
 */
export const tenantContext = (
  _req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  runWithContext({ isSuperAdmin: false, coreCache: new Map() }, next);
};

const lookupCompanyId = async (uuid: unknown): Promise<number | undefined> => {
  if (typeof uuid !== "string" || !UUID_RE.test(uuid)) return undefined;
  return (await new CompanyDAO().getIdByUuid(uuid)) ?? undefined;
};

/**
 * Resolves the effective company once per request, with `getCompanyScope`
 * precedence (superAdmin: `?companyId`, then `body.companyId`; everyone else:
 * the token), and sets `req.companyId` plus the request context.
 *
 * A superAdmin targets a tenant with `?companyId=<uuid>` (the SPA's company
 * switcher, which remembers its choice in localStorage). If that company has
 * since been deleted, every scoped list answers 200 with zero rows and the app
 * reads as EMPTY rather than STALE — on every screen at once, with nothing
 * pointing at the switcher. Answer 404 so the caller can tell the difference.
 *
 * Only superAdmins can supply this: for everyone else parseQueryParams ignores
 * the parameter entirely and uses the token's company.
 *
 * @returns false when it has already answered; the caller must not call next().
 */
export const resolveTenantContext = async (
  req: Request,
  res: Response,
): Promise<boolean> => {
  const selected = req.query.companyId;
  const selectsCompany =
    req.user?.role === "superAdmin" && typeof selected === "string";

  if (selectsCompany && !UUID_RE.test(selected)) {
    res.status(404).json(COMPANY_NOT_FOUND_BODY);
    return false;
  }

  const scope = getCompanyScope(req);
  const companyId = await lookupCompanyId(scope.companyUuid);

  if (selectsCompany && companyId === undefined) {
    res.status(404).json(COMPANY_NOT_FOUND_BODY);
    return false;
  }

  req.companyId = companyId;

  const context = getRequestContext();
  if (context) {
    context.isSuperAdmin = scope.isSuperAdmin;
    if (companyId !== undefined) {
      context.companyId = companyId;
      context.companyUuid = scope.companyUuid;
    }
  }
  return true;
};
