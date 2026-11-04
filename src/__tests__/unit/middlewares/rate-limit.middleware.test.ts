import { jest, describe, it, expect, afterEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";

/**
 * `RATE_LIMIT_AUTH_MAX` exists so a local verification pass is not rate-limited
 * into uselessness (5 logins/minute made every browser check and every
 * cross-repo suite sleep 65 s between logins). The risk it introduces is that a
 * deployed environment silently loses its auth limit, so both directions are
 * asserted here: the variable is honoured when set, and the default stays 5
 * when it is absent or junk.
 *
 * The limiters are module-level constants built at import time, so each case
 * re-imports the module under its own environment via `jest.isolateModules`.
 */

type Captured = { status?: number; nexts: number };

/** Drives a limiter `times` times from one IP and reports what happened. */
async function hit(
  limiter: (req: Request, res: Response, next: NextFunction) => void,
  times: number,
  ip = "203.0.113.7",
): Promise<Captured> {
  const captured: Captured = { nexts: 0 };
  for (let i = 0; i < times; i += 1) {
    const req = { ip, headers: {}, method: "POST", url: "/login" };
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json() {
        return this;
      },
      setHeader() {
        return this;
      },
      getHeader() {
        return undefined;
      },
      removeHeader() {
        return this;
      },
    };
    await new Promise<void>((resolve) => {
      limiter(
        req as unknown as Request,
        res as unknown as Response,
        (() => {
          captured.nexts += 1;
          resolve();
        }) as NextFunction,
      );
      // The handler path never calls next(), so resolve on the next tick too.
      setImmediate(resolve);
    });
  }
  return captured;
}

const loadAuthLimiter = (): ((
  req: Request,
  res: Response,
  next: NextFunction,
) => void) => {
  let mod!: typeof import("../../../middlewares/rate-limit.middleware");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../../../middlewares/rate-limit.middleware");
  });
  return mod.authRateLimiter as unknown as (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;
};

const original = process.env.RATE_LIMIT_AUTH_MAX;

afterEach(() => {
  if (original === undefined) delete process.env.RATE_LIMIT_AUTH_MAX;
  else process.env.RATE_LIMIT_AUTH_MAX = original;
});

describe("authRateLimiter — RATE_LIMIT_AUTH_MAX", () => {
  it("defaults to 5 per minute when the variable is unset", async () => {
    delete process.env.RATE_LIMIT_AUTH_MAX;
    const limiter = loadAuthLimiter();

    const under = await hit(limiter, 5, "203.0.113.1");
    expect(under.nexts).toBe(5);
    expect(under.status).toBeUndefined();

    const over = await hit(limiter, 1, "203.0.113.1");
    expect(over.status).toBe(429);
  });

  it("honours a raised limit so local verification is not throttled", async () => {
    process.env.RATE_LIMIT_AUTH_MAX = "100";
    const limiter = loadAuthLimiter();

    const result = await hit(limiter, 20, "203.0.113.2");
    expect(result.nexts).toBe(20);
    expect(result.status).toBeUndefined();
  });

  it("falls back to 5 when the variable is not a positive integer", async () => {
    process.env.RATE_LIMIT_AUTH_MAX = "not-a-number";
    const limiter = loadAuthLimiter();

    await hit(limiter, 5, "203.0.113.3");
    const over = await hit(limiter, 1, "203.0.113.3");
    expect(over.status).toBe(429);
  });
});
