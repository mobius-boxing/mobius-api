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
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000); // 5 minutes

/**
 * Get client identifier from request
 * Uses IP address by default, but can use user ID if authenticated
 */
const getClientIdentifier = (req: Request): string => {
  // Use user ID if authenticated for more accurate rate limiting
  if (req.user && req.user.userId) {
    return `user:${req.user.userId}`;
  }

  // Otherwise use IP address
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket.remoteAddress ||
    "unknown";

  return `ip:${ip}`;
};

/**
 * Create a rate limiter middleware
 *
 * @param max - Maximum number of requests allowed in the window
 * @param windowMinutes - Time window in minutes
 * @param message - Optional custom error message
 *
 * @returns Express middleware function
 *
 * @example
 * // Allow 100 requests per 15 minutes
 * router.post('/login', createRateLimiter(100, 15), controller.login);
 *
 * @example
 * // Allow 5 requests per minute for sensitive endpoints
 * router.post('/reset-password', createRateLimiter(5, 1), controller.resetPassword);
 */
export const createRateLimiter = (
  max: number,
  windowMinutes: number,
  message?: string,
) => {
  const windowMs = windowMinutes * 60 * 1000;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const identifier = getClientIdentifier(req);
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
 */
export const sensitiveRateLimiter = createRateLimiter(
  3,
  5,
  "Too many requests for this sensitive operation. Please try again later.",
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
