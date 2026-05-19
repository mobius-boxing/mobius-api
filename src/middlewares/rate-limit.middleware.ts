import { Request, Response, NextFunction } from "express";

interface IRateLimitRecord {
  count: number;
  resetTime: number;
}

// In-memory store keyed by IP address or authenticated user id. Not shared across processes —
// behind a load balancer each instance enforces its own limit (tradeoff: simpler, less accurate).
const rateLimitStore = new Map<string, IRateLimitRecord>();

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
);

/**
 * Authenticated requests key on user id, anonymous requests on IP. `routeKey` lets one
 * client hit different routes without exhausting a shared bucket.
 */
const getClientIdentifier = (req: Request, routeKey?: string): string => {
  let baseIdentifier: string;

  if (req.user && req.user.userId) {
    baseIdentifier = `user:${req.user.userId}`;
  } else {
    const ip =
      req.ip ||
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.socket.remoteAddress ||
      "unknown";
    baseIdentifier = `ip:${ip}`;
  }

  return routeKey ? `${baseIdentifier}:${routeKey}` : baseIdentifier;
};

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

      let record = rateLimitStore.get(identifier);

      if (!record || record.resetTime < now) {
        record = {
          count: 1,
          resetTime: now + windowMs,
        };
        rateLimitStore.set(identifier, record);

        res.setHeader("X-RateLimit-Limit", max.toString());
        res.setHeader("X-RateLimit-Remaining", (max - 1).toString());
        res.setHeader(
          "X-RateLimit-Reset",
          new Date(record.resetTime).toISOString(),
        );

        next();
        return;
      }

      record.count++;

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

      res.setHeader("X-RateLimit-Limit", max.toString());
      res.setHeader("X-RateLimit-Remaining", (max - record.count).toString());
      res.setHeader(
        "X-RateLimit-Reset",
        new Date(record.resetTime).toISOString(),
      );

      next();
    } catch (error: any) {
      // Never block requests because the limiter itself failed — fail open.
      console.error("Rate limit error:", error);
      next();
    }
  };
};

export const authRateLimiter = createRateLimiter(
  5,
  1,
  "Too many authentication attempts. Please try again later.",
);

export const apiRateLimiter = createRateLimiter(
  100,
  15,
  "API rate limit exceeded. Please try again later.",
);

export const publicRateLimiter = createRateLimiter(
  200,
  15,
  "Rate limit exceeded. Please try again later.",
);

// Global limiter (no routeKey) — every "sensitive" call by a user shares this bucket. Most callers
// should use one of the route-specific limiters below instead.
export const sensitiveRateLimiter = createRateLimiter(
  3,
  5,
  "Too many requests for this sensitive operation. Please try again later.",
);

export const sensitiveUserDeletionRateLimiter = createRateLimiter(
  5,
  5,
  "Too many user deletion requests. Please try again later.",
  "users:delete",
);

export const sensitiveCustomerDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many customer deletion requests. Please try again later.",
  "customers:delete",
);

export const sensitivePaperSupplyDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many paper supply deletion requests. Please try again later.",
  "paper-supplies:delete",
);

export const sensitiveProductTypeDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many product type deletion requests. Please try again later.",
  "product-types:delete",
);

export const sensitiveBoxTypeDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many box type deletion requests. Please try again later.",
  "box-types:delete",
);

export const sensitiveGlueTypeDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many glue type deletion requests. Please try again later.",
  "glue-types:delete",
);

export const sensitiveStrappingTypeDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many strapping type deletion requests. Please try again later.",
  "strapping-types:delete",
);

export const sensitiveComplementDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many complement deletion requests. Please try again later.",
  "complements:delete",
);

export const sensitiveTraceTypeDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many trace type deletion requests. Please try again later.",
  "trace-types:delete",
);

export const clearRateLimit = (identifier: string): void => {
  rateLimitStore.delete(identifier);
};

export const getRateLimitStatus = (
  identifier: string,
): IRateLimitRecord | null => {
  return rateLimitStore.get(identifier) || null;
};

export const clearAllRateLimits = (): void => {
  rateLimitStore.clear();
};
