// @ts-nocheck
/**
 * `requirePermission` — the data-driven permission gate. Named apart
 * from a hypothetical `auth.middleware.test.ts` so a later suite covering
 * `authenticate`/`requireRole` doesn't collide with this file (none exists
 * yet).
 *
 * An authz lookup failure must never allow: a thrown lookup answers 503
 * `AUTHZ_UNAVAILABLE` and calls neither `next()` nor a 200/403 — `next(err)`
 * would hand the failure to the generic error middleware, which is not the
 * contract here (L-018: this is the one case attackers can force by breaking
 * the DB, so "fails how" matters as much as "fails closed").
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import { requirePermission } from "../../../middlewares/auth.middleware";
import { RbacService } from "../../../services/rbac.service";
import {
  createMockRequest,
  createMockResponse,
} from "../../mocks/express.mock";

const run = async (
  user: any,
  options?: { allowReadOnly?: boolean },
  code = "orders.edit",
) => {
  const req = createMockRequest({
    user,
    baseUrl: "/api/sales-orders",
    path: "/",
  }) as Request;
  const res = createMockResponse() as Response;
  const next = jest.fn() as unknown as NextFunction;

  await requirePermission(code, options)(req, res, next);
  return { req, res, next };
};

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("requirePermission — superAdmin bypass", () => {
  it("passes without a lookup", async () => {
    const spy = jest.spyOn(RbacService, "authzForUserUuid");
    const { res, next } = await run({ userId: "u-1", role: "superAdmin" });

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("requirePermission — no authenticated user", () => {
  it("answers 401 without calling next", async () => {
    const { res, next } = await run(undefined);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requirePermission — normal decisions", () => {
  it("passes when the code is granted", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockResolvedValue({ codes: ["orders.edit"] });

    const { res, next } = await run({ userId: "u-1", role: "member" });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("answers 403 when the code is not granted", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockResolvedValue({ codes: [] });

    const { res, next } = await run({ userId: "u-1", role: "member" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requirePermission — AC-7: lookup failure answers 503, never allows", () => {
  it("answers 503 AUTHZ_UNAVAILABLE when the authz lookup throws", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockRejectedValue(new Error("connection reset"));

    const { res, next } = await run({ userId: "u-1", role: "member" });

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: "AUTHZ_UNAVAILABLE" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("does not forward the error to next() (mutation: a bare next(err) would 500, not 503)", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockRejectedValue(new Error("connection reset"));

    const { next } = await run({ userId: "u-1", role: "member" });

    expect(next).not.toHaveBeenCalled();
  });

  it("a lookup failure still 503s an admin — the fallback never overrides it", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockRejectedValue(new Error("connection reset"));

    const { res, next } = await run({ userId: "u-1", role: "admin" });

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requirePermission — legacy fallback removed", () => {
  it("denies (and never logs rbac.legacy_fallback_allow) through the real isAllowed when a roleless admin has no matching code", async () => {
    jest
      .spyOn(RbacService, "authzForUserUuid")
      .mockResolvedValue({ codes: [] });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { res, next } = await run({ userId: "u-1", role: "admin" });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
