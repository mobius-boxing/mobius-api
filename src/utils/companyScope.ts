import { Request } from "express";

export interface CompanyScopeResult {
  companyId: number | undefined;
  companyUuid: string | undefined;
  isSuperAdmin: boolean;
  hasCompanyScope: boolean;
}

/**
 * SECURITY: SuperAdmins may target any company via query/body; regular users are forced to their
 * JWT-assigned company. Body/query companyId is never honored for non-SuperAdmins.
 */
export function getCompanyScope(req: Request): CompanyScopeResult {
  const user = req.user;
  const isSuperAdmin = user?.role === "superAdmin";

  let companyUuid: string | undefined;

  if (isSuperAdmin) {
    const queryCompanyId = req.query.companyId as string | undefined;
    const bodyCompanyId = req.body?.companyId as string | undefined;
    companyUuid = queryCompanyId || bodyCompanyId;
  } else {
    // user.companyId in the JWT is already the UUID string.
    companyUuid = user?.companyId as unknown as string | undefined;
  }

  return {
    companyId: undefined,
    companyUuid,
    isSuperAdmin,
    hasCompanyScope: companyUuid !== undefined,
  };
}

export function getCompanyFilterUuid(req: Request): string | undefined {
  const user = req.user;
  const isSuperAdmin = user?.role === "superAdmin";

  if (isSuperAdmin) {
    // No query param ⇒ no filter ⇒ SuperAdmin sees all companies.
    return req.query.companyId as string | undefined;
  }

  return user?.companyId as unknown as string | undefined;
}

export function hasCompanyAccess(
  req: Request,
  targetCompanyUuid: string | undefined,
): boolean {
  const user = req.user;

  if (user?.role === "superAdmin") {
    return true;
  }

  const userCompanyUuid = user?.companyId as unknown as string | undefined;
  return userCompanyUuid === targetCompanyUuid;
}

export interface ResolvedCompanyResult {
  companyUuid: string;
  success: true;
}

export interface ResolvedCompanyError {
  message: string;
  success: false;
}

/**
 * SECURITY: SuperAdmins MUST specify companyId in the body; regular users' company comes from JWT
 * and any body-supplied companyId is ignored.
 */
export function getCompanyForCreate(
  req: Request,
): ResolvedCompanyResult | ResolvedCompanyError {
  const user = req.user;
  const isSuperAdmin = user?.role === "superAdmin";

  if (isSuperAdmin) {
    const bodyCompanyId = req.body?.companyId as string | undefined;
    if (!bodyCompanyId) {
      return {
        success: false,
        message: "SuperAdmin must specify a company",
      };
    }
    return {
      success: true,
      companyUuid: bodyCompanyId,
    };
  }

  const userCompanyId = user?.companyId as unknown as string | undefined;
  if (!userCompanyId) {
    return {
      success: false,
      message: "User must belong to a company to create resources",
    };
  }

  return {
    success: true,
    companyUuid: userCompanyId,
  };
}
