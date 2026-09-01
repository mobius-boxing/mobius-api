import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { UserDAO } from "../dao";
import { CompanyDAO } from "../dao/company/company.dao";
import { armAudit } from "../database/audit-context";

interface IJWTPayload {
  userId: string;
  email: string;
  role: "member" | "admin" | "superAdmin";
  companyId?: string;
  // Enabled module slugs for the user's company (empty for superAdmin / no company).
  modules?: string[];
  // Store customer tokens carry audience:'store'; internal tokens never set it.
  // Used purely so internal auth can reject store tokens (see authenticate).
  audience?: string;
  iat?: number;
  exp?: number;
}

/** RFC 4122 shape only — a malformed uuid would make Postgres throw, not answer. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
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
const rejectMissingTargetCompany = async (
  req: Request,
  res: Response,
): Promise<boolean> => {
  const companyUuid = req.query.companyId;
  if (typeof companyUuid !== "string" || req.user?.role !== "superAdmin") {
    return true;
  }

  const companyId = UUID_RE.test(companyUuid)
    ? await new CompanyDAO().getIdByUuid(companyUuid)
    : null;

  if (companyId !== null) return true;

  res.status(404).json({
    success: false,
    code: "COMPANY_NOT_FOUND",
    message: "The selected company no longer exists.",
  });
  return false;
};

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Authentication required. No token provided.",
      });
      return;
    }

    const token = authHeader.substring(7);

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const decoded = jwt.verify(token, jwtSecret) as IJWTPayload;

    // SECURITY: re-check existence + active flag on every request so revoked/disabled accounts
    // can't keep using a still-valid JWT.
    const userDAO = new UserDAO();
    const user = await userDAO.getByUuid(decoded.userId);

    if (!user) {
      res.status(401).json({
        success: false,
        message: "User no longer exists.",
      });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({
        success: false,
        message: "User account is inactive.",
      });
      return;
    }

    (req as any).user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
    };

    if (!(await rejectMissingTargetCompany(req, res))) return;

    // AUDIT (P1): arm the request here and nowhere earlier. `req.user` is set
    // and `rejectMissingTargetCompany` has already resolved the superAdmin's
    // target company, so `armAudit` records the EFFECTIVE tenant (L-009) rather
    // than the token's own. From this line on, `db(key)` hands a mutating
    // request the ambient transaction.
    await armAudit(req);

    next();
  } catch (error: any) {
    next(error);
  }
};

/**
 * Sets req.user when a valid token is present; never rejects.
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      next();
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const decoded = jwt.verify(token, jwtSecret) as IJWTPayload;

    const userDAO = new UserDAO();
    const user = await userDAO.getByUuid(decoded.userId);

    if (user && user.isActive) {
      (req as any).user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        companyId: decoded.companyId,
      };
    }

    // AUDIT (P1): same arming as `authenticate`. `optionalAuth` is exported but
    // mounted on no route today — wired for symmetry so a future route that
    // adopts it is audited by default rather than silently unarmed. With no
    // valid token `req.user` is unset and `armAudit` still arms the request,
    // recording an anonymous actor.
    await armAudit(req);

    next();
  } catch (error: any) {
    // Invalid token = continue unauthenticated, matching optional-auth contract.
    next();
  }
};

/**
 * Data-driven permission gate (module 02 RBAC grid). Checks the caller's role
 * grants for `code`; with allowReadOnly, the `.readonly` variant also passes
 * (Procusto's SoloLectura pairing — use on GET routes).
 *
 * Transition semantics (02/08-migration-notes dual-read): superAdmin always
 * passes; a user with NO roleId falls back to the legacy enum (admin passes,
 * member is denied). Once every user carries a roleId the fallback dies with
 * the enum column.
 */
export const requirePermission = (
  code: string,
  options?: { allowReadOnly?: boolean },
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (user.role === "superAdmin") {
      next();
      return;
    }

    try {
      // Cache per request — several gates may run on one request.
      let codes: string[] | undefined = req.permissionCodes;
      let hasRole: boolean | undefined = req.permissionHasRole;
      if (codes === undefined || hasRole === undefined) {
        const { RbacService } = await import("../services/rbac.service");
        // NOTE: UserDAO.getByUuid must not be used here — its mapToInterface
        // drops roleId, which would silently disable the whole grid.
        const authz = await RbacService.authzForUserUuid(user.userId);
        hasRole = authz.hasRole;
        codes = authz.codes;
        req.permissionCodes = codes;
        req.permissionHasRole = hasRole;
      }

      // Decision semantics live in ONE place (RbacService.isAllowed) — the
      // superAdmin bypass above is only a fetch-skipping fast path.
      const { RbacService } = await import("../services/rbac.service");
      if (!RbacService.isAllowed(user.role, hasRole, codes, code, options)) {
        res.status(403).json({
          success: false,
          message: `Insufficient permissions. Required: ${code}`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireRole = (
  roles: Array<"member" | "admin" | "superAdmin">,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!(req as any).user) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (!roles.includes((req as any).user.role)) {
      res.status(403).json({
        success: false,
        message:
          "Insufficient permissions. Required role: " + roles.join(" or "),
      });
      return;
    }

    next();
  };
};

export const requireSuperAdmin = () => {
  return requireRole(["superAdmin"]);
};

export const requireAdmin = () => {
  return requireRole(["admin", "superAdmin"]);
};

/**
 * Resource company id is taken from params/body/query; SuperAdmin bypasses the check.
 */
export const requireSameCompany = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!(req as any).user) {
    res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
    return;
  }

  if ((req as any).user.role === "superAdmin") {
    next();
    return;
  }

  const resourceCompanyId =
    req.params.companyId || req.body.companyId || req.query.companyId;

  if (!resourceCompanyId) {
    res.status(400).json({
      success: false,
      message: "Company ID is required.",
    });
    return;
  }

  // Both sides are UUID strings (JWT carries UUID, request payloads carry UUID).
  if ((req as any).user.companyId !== resourceCompanyId) {
    res.status(403).json({
      success: false,
      message:
        "Access denied. You can only access resources from your own company.",
    });
    return;
  }

  next();
};

export const generateToken = (user: {
  id?: string;
  email: string;
  role: "member" | "admin" | "superAdmin";
  companyId?: string;
  modules?: string[];
}): string => {
  // SECURITY (H1): fail closed — never sign with an empty secret.
  const jwtSecret = process.env.JWT_SECRET;
  const jwtExpire = process.env.JWT_EXPIRE || "5h";

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const payload: IJWTPayload = {
    userId: user.id!,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    modules: user.modules ?? [],
  };

  return jwt.sign(payload, jwtSecret, {
    expiresIn: jwtExpire as string,
  } as jwt.SignOptions);
};
