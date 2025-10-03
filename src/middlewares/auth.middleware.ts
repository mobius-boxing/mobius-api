import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { UserDAO } from "../dao";

/**
 * JWT Payload interface
 */
interface IJWTPayload {
  userId: number;
  uuid: string;
  email: string;
  role: "member" | "admin" | "superAdmin";
  companyId?: number;
  iat?: number;
  exp?: number;
}

/**
 * Authenticate middleware - Verifies JWT token and attaches user to request
 * Returns 401 if token is missing or invalid
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Authentication required. No token provided.",
      });
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const decoded = jwt.verify(token, jwtSecret) as IJWTPayload;

    // Verify user still exists and is active
    const userDAO = new UserDAO();
    const user = await userDAO.getById(decoded.userId);

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

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      uuid: decoded.uuid,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
    };

    next();
  } catch (error: any) {
    // Pass JWT errors to error middleware
    next(error);
  }
};

/**
 * Optional authentication - Sets user if token is present, but doesn't fail if missing
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // No token provided, continue without user
      next();
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const decoded = jwt.verify(token, jwtSecret) as IJWTPayload;

    // Verify user exists and is active
    const userDAO = new UserDAO();
    const user = await userDAO.getById(decoded.userId);

    if (user && user.isActive) {
      req.user = {
        userId: decoded.userId,
        uuid: decoded.uuid,
        email: decoded.email,
        role: decoded.role,
        companyId: decoded.companyId,
      };
    }

    next();
  } catch (error: any) {
    // Continue without user if token is invalid
    next();
  }
};

/**
 * Require specific roles - Returns 403 if user doesn't have required role
 * @param roles - Array of allowed roles
 */
export const requireRole = (roles: Array<"member" | "admin" | "superAdmin">) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: "Insufficient permissions. Required role: " + roles.join(" or "),
      });
      return;
    }

    next();
  };
};

/**
 * Require SuperAdmin role only
 */
export const requireSuperAdmin = () => {
  return requireRole(["superAdmin"]);
};

/**
 * Require Admin or SuperAdmin role
 */
export const requireAdmin = () => {
  return requireRole(["admin", "superAdmin"]);
};

/**
 * Ensure user belongs to the same company as the resource
 * Resource company ID should be in req.params.companyId or req.body.companyId
 */
export const requireSameCompany = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
    return;
  }

  // SuperAdmins can access any company
  if (req.user.role === "superAdmin") {
    next();
    return;
  }

  // Get company ID from params or body
  const resourceCompanyId =
    req.params.companyId || req.body.companyId || req.query.companyId;

  if (!resourceCompanyId) {
    res.status(400).json({
      success: false,
      message: "Company ID is required.",
    });
    return;
  }

  // Convert to number for comparison
  const companyId =
    typeof resourceCompanyId === "string"
      ? parseInt(resourceCompanyId, 10)
      : resourceCompanyId;

  // Check if user belongs to the same company
  if (req.user.companyId !== companyId) {
    res.status(403).json({
      success: false,
      message: "Access denied. You can only access resources from your own company.",
    });
    return;
  }

  next();
};

/**
 * Generate JWT token for user
 * @param user - User object with id, uuid, email, role, and companyId
 * @returns JWT token string
 */
export const generateToken = (user: {
  id?: number;
  uuid?: string;
  email: string;
  role: "member" | "admin" | "superAdmin";
  companyId?: number;
}): string => {
  const jwtSecret = process.env.JWT_SECRET;
  const jwtExpire = process.env.JWT_EXPIRE || "5h";

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const payload: IJWTPayload = {
    userId: user.id!,
    uuid: user.uuid!,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  };

  return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpire });
};
