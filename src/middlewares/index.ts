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

// Module-enabled gate middleware
export { requireModule, requireStoreModule } from "./module.middleware";

// Store-customer authentication middleware (isolated from internal auth)
export { authenticateStore } from "./store-auth.middleware";

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
  sensitiveUserDeletionRateLimiter,
  sensitiveCustomerDeletionRateLimiter,
  sensitivePaperSupplyDeletionRateLimiter,
  sensitiveProductTypeDeletionRateLimiter,
  sensitiveBoxTypeDeletionRateLimiter,
  sensitiveGlueTypeDeletionRateLimiter,
  sensitiveStrappingTypeDeletionRateLimiter,
  sensitiveComplementDeletionRateLimiter,
  sensitiveTraceTypeDeletionRateLimiter,
  clearRateLimit,
  clearAllRateLimits,
  getRateLimitStatus,
} from "./rate-limit.middleware";
