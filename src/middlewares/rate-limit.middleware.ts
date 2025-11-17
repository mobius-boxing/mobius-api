import { Request, Response, NextFunction } from "express";

/**
 * Rate limit record interface
 */
interface IRateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * In-memory storage for rate limit records
 * Key: IP address or identifier
 * Value: Rate limit record
 */
const rateLimitStore = new Map<string, IRateLimitRecord>();

/**
 * Clean up expired rate limit records every 5 minutes
 */
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (record.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000,
); // 5 minutes

/**
 * Get client identifier from request
 * Uses IP address by default, but can use user ID if authenticated
 * Optionally includes a route key to make rate limits route-specific
 */
const getClientIdentifier = (req: Request, routeKey?: string): string => {
  let baseIdentifier: string;

  // Use user ID if authenticated for more accurate rate limiting
  if (req.user && req.user.userId) {
    baseIdentifier = `user:${req.user.userId}`;
  } else {
    // Otherwise use IP address
    const ip =
      req.ip ||
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.socket.remoteAddress ||
      "unknown";
    baseIdentifier = `ip:${ip}`;
  }

  // Add route key if provided to make rate limits route-specific
  return routeKey ? `${baseIdentifier}:${routeKey}` : baseIdentifier;
};

/**
 * Create a rate limiter middleware
 *
 * @param max - Maximum number of requests allowed in the window
 * @param windowMinutes - Time window in minutes
 * @param message - Optional custom error message
 * @param routeKey - Optional route key to make rate limits route-specific
 *
 * @returns Express middleware function
 *
 * @example
 * // Allow 100 requests per 15 minutes
 * router.post('/login', createRateLimiter(100, 15), controller.login);
 *
 * @example
 * // Allow 5 requests per minute for sensitive endpoints with route-specific limiting
 * router.post('/reset-password', createRateLimiter(5, 1, 'Too many attempts', 'reset-password'), controller.resetPassword);
 */
export const createRateLimiter = (
  max: number,
  windowMinutes: number,
  message?: string,
  routeKey?: string,
) => {
  const windowMs = windowMinutes * 60 * 1000;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const identifier = getClientIdentifier(req, routeKey);
      const now = Date.now();

      // Get or create rate limit record
      let record = rateLimitStore.get(identifier);

      if (!record || record.resetTime < now) {
        // Create new record or reset if window has passed
        record = {
          count: 1,
          resetTime: now + windowMs,
        };
        rateLimitStore.set(identifier, record);

        // Add rate limit headers
        res.setHeader("X-RateLimit-Limit", max.toString());
        res.setHeader("X-RateLimit-Remaining", (max - 1).toString());
        res.setHeader(
          "X-RateLimit-Reset",
          new Date(record.resetTime).toISOString(),
        );

        next();
        return;
      }

      // Increment request count
      record.count++;

      // Check if limit exceeded
      if (record.count > max) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);

        res.setHeader("X-RateLimit-Limit", max.toString());
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader(
          "X-RateLimit-Reset",
          new Date(record.resetTime).toISOString(),
        );
        res.setHeader("Retry-After", retryAfter.toString());

        res.status(429).json({
          success: false,
          message:
            message ||
            `Too many requests. Please try again after ${retryAfter} seconds.`,
          retryAfter,
        });
        return;
      }

      // Update headers
      res.setHeader("X-RateLimit-Limit", max.toString());
      res.setHeader("X-RateLimit-Remaining", (max - record.count).toString());
      res.setHeader(
        "X-RateLimit-Reset",
        new Date(record.resetTime).toISOString(),
      );

      next();
    } catch (error: any) {
      // Don't block request if rate limiting fails
      console.error("Rate limit error:", error);
      next();
    }
  };
};

/**
 * Preset rate limiters for common use cases
 */

/**
 * Strict rate limiter for authentication endpoints
 * 5 requests per minute
 */
export const authRateLimiter = createRateLimiter(
  5,
  1,
  "Too many authentication attempts. Please try again later.",
);

/**
 * Standard rate limiter for API endpoints
 * 100 requests per 15 minutes
 */
export const apiRateLimiter = createRateLimiter(
  100,
  15,
  "API rate limit exceeded. Please try again later.",
);

/**
 * Relaxed rate limiter for public endpoints
 * 200 requests per 15 minutes
 */
export const publicRateLimiter = createRateLimiter(
  200,
  15,
  "Rate limit exceeded. Please try again later.",
);

/**
 * Strict rate limiter for sensitive operations
 * 3 requests per 5 minutes
 * Note: This is a global limiter. Use route-specific limiters below for better granularity.
 */
export const sensitiveRateLimiter = createRateLimiter(
  3,
  5,
  "Too many requests for this sensitive operation. Please try again later.",
);

/**
 * Route-specific rate limiter for user deletion
 * 5 requests per 5 minutes per user deletion endpoint
 */
export const sensitiveUserDeletionRateLimiter = createRateLimiter(
  5,
  5,
  "Too many user deletion requests. Please try again later.",
  "users:delete",
);

/**
 * Route-specific rate limiter for customer deletion
 * 10 requests per 5 minutes per customer deletion endpoint
 */
export const sensitiveCustomerDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many customer deletion requests. Please try again later.",
  "customers:delete",
);

/**
 * Route-specific rate limiter for paper supply deletion
 * 10 requests per 5 minutes per paper supply deletion endpoint
 */
export const sensitivePaperSupplyDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many paper supply deletion requests. Please try again later.",
  "paper-supplies:delete",
);

/**
 * Clear rate limit for a specific identifier
 * Useful for testing or manual intervention
 */
export const clearRateLimit = (identifier: string): void => {
  rateLimitStore.delete(identifier);
};

/**
 * Get current rate limit status for an identifier
 */
export const getRateLimitStatus = (
  identifier: string,
): IRateLimitRecord | null => {
  return rateLimitStore.get(identifier) || null;
};

/**
 * Clear all rate limit records
 * Useful for testing or system reset
 */
export const clearAllRateLimits = (): void => {
  rateLimitStore.clear();
};
