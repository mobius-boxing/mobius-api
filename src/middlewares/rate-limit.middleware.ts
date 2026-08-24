import { Request, Response } from "express";
import { rateLimit, ipKeyGenerator, type Options } from "express-rate-limit";

/**
 * SECURITY (H3): rate limiting backed by `express-rate-limit`.
 *
 * Why this replaced the hand-rolled limiter:
 *  - The old limiter caught its own errors and called next() — i.e. it FAILED OPEN, so any internal
 *    error silently disabled rate limiting. express-rate-limit fails closed.
 *  - The old limiter trusted client-supplied `x-forwarded-for` / `x-real-ip` headers, which are
 *    trivially spoofable. We now set `app.set("trust proxy", 1)` in app.ts (the API sits behind a
 *    single CloudFront proxy) and let the library derive the client IP from `req.ip`.
 *
 * NOTE (scaling): this uses the library's default in-memory store, so each process keeps its own
 * counters. If the API is ever scaled to multiple instances, swap in a shared store (e.g.
 * `rate-limit-redis`) so limits are enforced globally.
 */

/**
 * Key by authenticated user id when present, otherwise by the (trusted) client IP.
 * `routeKey` namespaces a client across distinct routes so one bucket isn't shared.
 * For IP keys we use `ipKeyGenerator` so IPv6 addresses are normalized to a subnet.
 */
const makeKeyGenerator = (routeKey?: string) => {
  return (req: Request): string => {
    const base = req.user?.userId
      ? `user:${req.user.userId}`
      : `ip:${ipKeyGenerator(req.ip ?? "")}`;
    return routeKey ? `${base}:${routeKey}` : base;
  };
};

const jsonHandler = (message: string) => {
  return (_req: Request, res: Response): void => {
    res.status(429).json({
      success: false,
      message,
    });
  };
};

/**
 * Factory mirroring the previous signature so existing call sites keep working:
 * createRateLimiter(max, windowMinutes, message?, routeKey?).
 */
/** Env-overridable limit: RATE_LIMIT_<KEY>_MAX, falling back to the default. */
const envMax = (key: string, fallback: number): number => {
  const raw = process.env[`RATE_LIMIT_${key}_MAX`];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const createRateLimiter = (
  max: number,
  windowMinutes: number,
  message?: string,
  routeKey?: string,
) => {
  const resolvedMessage =
    message || "Too many requests. Please try again later.";

  const options: Partial<Options> = {
    windowMs: windowMinutes * 60 * 1000,
    // express-rate-limit v8 renamed `max` → `limit`.
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    // SECURITY (H3): do NOT skip on errors — fail closed.
    keyGenerator: makeKeyGenerator(routeKey),
    handler: jsonHandler(resolvedMessage),
  };

  return rateLimit(options);
};

// SECURITY (H3): strict auth limiter for login / password-reset.
export const authRateLimiter = createRateLimiter(
  5,
  1,
  "Too many authentication attempts. Please try again later.",
  "auth",
);

export const apiRateLimiter = createRateLimiter(
  envMax("API", 600),
  15,
  "API rate limit exceeded. Please try again later.",
);

export const publicRateLimiter = createRateLimiter(
  envMax("PUBLIC", 400),
  15,
  "Rate limit exceeded. Please try again later.",
);

// Global default limiter mounted in app.ts.
export const globalRateLimiter = createRateLimiter(
  envMax("GLOBAL", 2000),
  15,
  "Rate limit exceeded. Please try again later.",
  "global",
);

export const sensitiveRateLimiter = createRateLimiter(
  3,
  5,
  "Too many requests for this sensitive operation. Please try again later.",
  "sensitive",
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

// Countdown deletions get their own bucket like every other entity. Sharing the
// generic `sensitive` bucket (3 per 5 min for ALL sensitive routes combined) put
// document/rubro/grupo deletes in competition with the reminder trigger, so an
// admin tidying up a rubro ran out of budget mid-cleanup.
export const sensitiveCountdownDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many countdown deletion requests. Please try again later.",
  "countdown:delete",
);

// Anulación of a pedido is its soft delete, so it gets a deletion-shaped bucket
// of its own rather than the generic `sensitive` one (3 per 5 min shared by
// EVERY sensitive route). It is a reversible operational PATCH — it ships its
// own `cancel` action — and a clerk voiding a fourth pedido in five minutes
// must not be 429'd; that is the trap documented above for countdown.
export const sensitiveSalesOrderVoidRateLimiter = createRateLimiter(
  10,
  5,
  "Too many sales order void requests. Please try again later.",
  "sales-orders:void",
);

// Órdenes de producción are high-volume operational rows, so the generic
// `sensitive` bucket (3 per 5 min shared by EVERY sensitive route) would make
// routine cleanup — and test teardown — unusable. They still get a destructive
// verb's own bucket rather than the plain API limiter, which is what every
// other entity's DELETE does.
export const sensitiveProductionOrderDeletionRateLimiter = createRateLimiter(
  10,
  5,
  "Too many production order deletion requests. Please try again later.",
  "production-orders:delete",
);

/**
 * No-op shims kept for backward compatibility. The library owns its in-memory store, so manual
 * clearing/inspection by identifier is no longer applicable. These are retained so existing
 * imports (e.g. in tests/tooling) don't break.
 */
export const clearRateLimit = (_identifier: string): void => {
  /* no-op: store is managed internally by express-rate-limit */
};

export const getRateLimitStatus = (_identifier: string): null => {
  return null;
};

export const clearAllRateLimits = (): void => {
  /* no-op: store is managed internally by express-rate-limit */
};
