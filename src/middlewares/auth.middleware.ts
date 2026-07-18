import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { UserDAO } from "../dao";

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

    // SECURITY: defense-in-depth token isolation. Store-customer tokens carry
    // audience:'store'; internal tokens never do. Reject store tokens here so that even
    // under a shared-secret fallback (STORE_JWT_SECRET unset) a store token can never pass
    // internal auth. This guard does not affect any existing internal token.
    if (decoded.audience === "store") {
      res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
      return;
    }

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
    const user = (req as any).user;
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
      let codes: string[] | undefined = (req as any).permissionCodes;
      let hasRole: boolean | undefined = (req as any).permissionHasRole;
      if (codes === undefined) {
        const { RbacService } = await import("../services/rbac.service");
        const userDAO = new UserDAO();
        const dbUser = await userDAO.getByUuid(user.userId);
        hasRole = !!(dbUser as any)?.roleId;
        codes = hasRole
          ? await RbacService.permissionCodesForUserUuid(user.userId)
          : [];
        (req as any).permissionCodes = codes;
        (req as any).permissionHasRole = hasRole;
      }

      if (!hasRole) {
        // Legacy fallback: no role assigned yet — honor the old enum.
        if (user.role === "admin") {
          next();
          return;
        }
        res.status(403).json({
          success: false,
          message: `Insufficient permissions. Required: ${code}`,
        });
        return;
      }

      const allowed =
        codes.includes(code) ||
        (options?.allowReadOnly === true && codes.includes(`${code}.readonly`));

      if (!allowed) {
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
