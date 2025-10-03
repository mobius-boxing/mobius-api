// Export all middleware from a single entry point

// Error handling middleware
export * from "./error/error.middleware";

// Authentication and authorization middleware
export {
  authenticate,
  optionalAuth,
  requireRole,
  requireSuperAdmin,
  requireAdmin,
  requireSameCompany,
  generateToken,
} from "./auth.middleware";

// Validation middleware
export {
  validateDTO,
  validate,
  validateUUID,
  validatePagination,
  validateRequiredFields,
} from "./validation.middleware";

// Rate limiting middleware
export {
  createRateLimiter,
  authRateLimiter,
  apiRateLimiter,
  publicRateLimiter,
  sensitiveRateLimiter,
  clearRateLimit,
  clearAllRateLimits,
  getRateLimitStatus,
} from "./rate-limit.middleware";
