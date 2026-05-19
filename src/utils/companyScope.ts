import { Request } from "express";

/**
 * Result of extracting company scope from request
 */
export interface CompanyScopeResult {
  /** The resolved company ID (numeric) or undefined if no company scope */
  companyId: number | undefined;
  /** Company UUID from query/body (for frontend communication) */
  companyUuid: string | undefined;
  /** Whether the user is a superAdmin */
  isSuperAdmin: boolean;
  /** Whether a company scope was resolved */
  hasCompanyScope: boolean;
}

/**
 * Extract company scope from authenticated request
 *
 * SuperAdmins: Can specify company via query param or body (UUID format expected from frontend)
 * Regular users: Always use their assigned company from the JWT token
 *
 * This centralizes the repeated pattern:
 * ```
 * const user = (req as any).user;
 * const companyId = user.role === "superAdmin" ? undefined : user.companyId;
 * ```
 *
 * @param req - Express request with authenticated user
 * @returns CompanyScopeResult with resolved company information
 *
 * @example
 * // In a controller:
 * const { companyUuid, isSuperAdmin } = getCompanyScope(req);
 * if (!isSuperAdmin && !companyUuid) {
 *   return res.status(400).json({ success: false, message: "Company required" });
 * }
 */
export function getCompanyScope(req: Request): CompanyScopeResult {
  const user = req.user;
  const isSuperAdmin = user?.role === "superAdmin";

  // For SuperAdmins, check query params and body for company UUID
  // Frontend sends company UUID via companyId query param
  let companyUuid: string | undefined;

  if (isSuperAdmin) {
    // SuperAdmin can specify company via query param or body
    const queryCompanyId = req.query.companyId as string | undefined;
    const bodyCompanyId = req.body?.companyId as string | undefined;
    companyUuid = queryCompanyId || bodyCompanyId;
  } else {
    // Regular users use their assigned company from token
    // Note: user.companyId in token is already the UUID (string)
    companyUuid = user?.companyId as unknown as string | undefined;
  }

  return {
    companyId: undefined, // Numeric ID should be resolved via DAO if needed
    companyUuid,
    isSuperAdmin,
    hasCompanyScope: companyUuid !== undefined,
  };
}

/**
 * Get company UUID for filtering in getAll operations
 *
 * This is a convenience function for the common pattern in controllers:
 * - SuperAdmin: use companyId from query params (if provided)
 * - Regular users: always use their company from token
 *
 * @param req - Express request with authenticated user
 * @returns Company UUID string or undefined (for SuperAdmin without filter)
 *
 * @example
 * // In a controller getAll method:
 * const companyUuid = getCompanyFilterUuid(req);
 * // Pass to DAO which joins with companies table
 */
export function getCompanyFilterUuid(req: Request): string | undefined {
  const user = req.user;
  const isSuperAdmin = user?.role === "superAdmin";

  if (isSuperAdmin) {
    // SuperAdmin: use query param if provided, otherwise no filter (see all)
    return req.query.companyId as string | undefined;
  }

  // Regular users: always filter by their company
  return user?.companyId as unknown as string | undefined;
}

/**
 * Check if user has access to a specific company
 *
 * @param req - Express request with authenticated user
 * @param targetCompanyUuid - The company UUID to check access for
 * @returns true if user can access the company's data
 *
 * @example
 * // In a controller:
 * if (!hasCompanyAccess(req, resource.companyUuid)) {
 *   return res.status(403).json({ success: false, message: "Access denied" });
 * }
 */
export function hasCompanyAccess(
  req: Request,
  targetCompanyUuid: string | undefined,
): boolean {
  const user = req.user;

  // SuperAdmin has access to all companies
  if (user?.role === "superAdmin") {
    return true;
  }

  // Regular users can only access their own company
  const userCompanyUuid = user?.companyId as unknown as string | undefined;
  return userCompanyUuid === targetCompanyUuid;
}

/**
 * Enforce company filter on query params for non-SuperAdmin users
 *
 * This modifies req.query.companyId to ensure regular users
 * always filter by their company. Used in getAll controllers.
 *
 * @param req - Express request with authenticated user
 *
 * @example
 * // In a controller getAll method:
 * enforceCompanyFilter(req);
 * const result = await this._dao.getAllWithFilters(req);
 */
export function enforceCompanyFilter(req: Request): void {
  const user = req.user;

  // For non-superAdmin users, enforce their company filter
  if (user?.role !== "superAdmin" && user?.companyId) {
    // Override/set the companyId query param with user's company UUID
    req.query.companyId = user.companyId as unknown as string;
  }
}

/**
 * Result of resolving company for create/update operations
 */
export interface ResolvedCompanyResult {
  /** Resolved company UUID */
  companyUuid: string;
  /** Whether resolution was successful */
  success: true;
}

export interface ResolvedCompanyError {
  /** Error message to return to client */
  message: string;
  /** Whether resolution failed */
  success: false;
}

/**
 * Get company UUID for create/update operations
 *
 * This is the secure way to determine which company a new resource belongs to:
 * - SuperAdmins: MUST provide companyId in request body (they can create for any company)
 * - Regular users: Company comes from JWT (request body companyId is IGNORED for security)
 *
 * @param req - Express request with authenticated user
 * @returns Resolved company UUID or error
 *
 * @example
 * // In a controller create method:
 * const companyResult = getCompanyForCreate(req);
 * if (!companyResult.success) {
 *   return res.status(400).json({ success: false, message: companyResult.message });
 * }
 * // Use companyResult.companyUuid for DAO operations
 */
export function getCompanyForCreate(
  req: Request,
): ResolvedCompanyResult | ResolvedCompanyError {
  const user = req.user;
  const isSuperAdmin = user?.role === "superAdmin";

  if (isSuperAdmin) {
    // SuperAdmin MUST specify which company to create resource for
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

  // Regular users: use company from JWT (secure - cannot be manipulated)
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
