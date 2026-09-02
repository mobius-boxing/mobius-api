/**
 * `requireEntityHistoryAccess` — the per-record history gate (audit P3, track
 * T5; ruling R-1, AC-7, AC-9).
 *
 * The decision under test is a three-way OR, and each leg is easy to lose
 * without any test noticing, so every leg has a case that fails when only that
 * leg is broken (L-018 — both mutation checks are recorded in the PR):
 *
 *  1. `audit.read` alone opens every entity — the ledger-wide code;
 *  2. the entity's own code opens that entity — including its `.readonly`
 *     variant, because opening a history is a read;
 *  3. a `null` entry (and an unknown table) means `requireAdmin` semantics —
 *     **admin and superAdmin only**, member denied. Deleting the role test in
 *     that branch is the mutation that "grants everyone", and it is what
 *     `ENTITY_READ_PERMISSION`'s 43 nulls make load-bearing.
 *
 * Only `RbacService.authzForUserUuid` is stubbed — the one call that would hit
 * the database. `RbacService.isAllowed` runs for real, because it owns the
 * superAdmin bypass, the roleless-admin fallback and the `.readonly` pairing;
 * a mocked decision function would leave all three untested (L-008 is the
 * lesson about exactly this layer lying quietly).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import { requireEntityHistoryAccess } from "../../../middlewares/audit-access.middleware";
import { RbacService } from "../../../services/rbac.service";
import { ENTITY_READ_PERMISSION } from "../../../database/audit-coverage";
import {
  createMockRequest,
  createMockResponse,
} from "../../mocks/express.mock";

/** An entity whose own routes enforce a code (`parts.edit`). */
const CODED_ENTITY = "parts";
/** An entity whose own routes are `requireAdmin()`-gated — a `null` entry. */
const ADMIN_ONLY_ENTITY = "customers";

type Role = "member" | "admin" | "superAdmin";

const authz = jest.fn<() => Promise<{ hasRole: boolean; codes: string[] }>>();

const run = async (
  role: Role,
  entityName: string,
  options: { codes?: string[]; hasRole?: boolean; user?: boolean } = {},
) => {
  const { codes = [], hasRole = codes.length > 0, user = true } = options;
  authz.mockResolvedValue({ hasRole, codes });

  const req = createMockRequest({
    params: { entityName, entityUuid: "8a1f0a34-6c2e-4a1e-9a2b-0d5f6c7e8a90" },
    ...(user
      ? {
          user: {
            userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
            email: "someone@acme.test",
            role,
          },
        }
      : {}),
  }) as Request;
  const res = createMockResponse() as Response;
  const next = jest.fn() as unknown as NextFunction;

  await requireEntityHistoryAccess(req, res, next);
  return { req, res, next };
};

/** The gate let the request through: `next()` with no error, no response. */
const expectPassed = (result: { res: Response; next: NextFunction }): void => {
  expect(result.next).toHaveBeenCalledWith();
  expect(result.res.status).not.toHaveBeenCalled();
};

const expectStatus = (
  result: { res: Response; next: NextFunction },
  status: number,
): void => {
  expect(result.res.status).toHaveBeenCalledWith(status);
  expect(result.next).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.spyOn(RbacService, "authzForUserUuid").mockImplementation(authz);
});

describe("requireEntityHistoryAccess — the fixtures it depends on", () => {
  it("reads the two entity kinds from the manifest, not from an assumption", () => {
    // If R-1's map is ever re-derived, these two cases must still be one of
    // each kind — otherwise the null-branch tests below prove nothing.
    expect(ENTITY_READ_PERMISSION[CODED_ENTITY]).toBe("parts.edit");
    expect(ENTITY_READ_PERMISSION[ADMIN_ONLY_ENTITY]).toBeNull();
  });
});

describe("requireEntityHistoryAccess — who passes", () => {
  it("passes a superAdmin without asking the database", async () => {
    const result = await run("superAdmin", CODED_ENTITY);
    expectPassed(result);
    expect(authz).not.toHaveBeenCalled();
  });

  it("passes an admin on a null-entry entity (requireAdmin semantics)", async () => {
    expectPassed(await run("admin", ADMIN_ONLY_ENTITY));
  });

  it("passes a member holding the entity's own code", async () => {
    expectPassed(await run("member", CODED_ENTITY, { codes: ["parts.edit"] }));
  });

  it("passes a member holding only the read-only variant of that code", async () => {
    expectPassed(
      await run("member", CODED_ENTITY, { codes: ["parts.edit.readonly"] }),
    );
  });

  it("passes a member holding audit.read on an entity whose own code they lack", async () => {
    expectPassed(await run("member", CODED_ENTITY, { codes: ["audit.read"] }));
  });

  it("passes a member holding audit.read on a null-entry entity", async () => {
    expectPassed(
      await run("member", ADMIN_ONLY_ENTITY, { codes: ["audit.read"] }),
    );
  });
});

describe("requireEntityHistoryAccess — who is refused", () => {
  it("refuses a member holding neither audit.read nor the entity's code", async () => {
    const result = await run("member", CODED_ENTITY, {
      codes: ["colors.edit"],
    });
    expectStatus(result, 403);
    expect(result.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining("parts.edit") as unknown as string,
      }),
    );
  });

  it("refuses a member on a null-entry entity — the branch that must not grant everyone", async () => {
    const result = await run("member", ADMIN_ONLY_ENTITY, {
      codes: ["customers.edit"],
    });
    expectStatus(result, 403);
    // The message is identical for a null entry and an unknown table, so it
    // cannot be used to probe which tables exist.
    expect(result.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "administrator account",
        ) as unknown as string,
      }),
    );
  });

  it("refuses a roleless member (the legacy-enum fallback denies)", async () => {
    expectStatus(
      await run("member", CODED_ENTITY, { codes: [], hasRole: false }),
      403,
    );
  });

  it("answers 401 when nothing authenticated the request", async () => {
    expectStatus(await run("member", CODED_ENTITY, { user: false }), 401);
  });
});

describe("requireEntityHistoryAccess — an unknown table", () => {
  it("refuses a member, revealing nothing about the schema", async () => {
    const result = await run("member", "not_a_table", {
      codes: ["parts.edit"],
    });
    expectStatus(result, 403);
    expect(result.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "administrator account",
        ) as unknown as string,
      }),
    );
  });

  it("passes an admin, so the controller answers the honest 400", async () => {
    // `code_sequences` is excluded from auditing entirely, so it has no
    // manifest entry: the gate must not turn its "not an audited table" 400
    // into a 403 for the callers who are allowed to read the ledger.
    expect(ENTITY_READ_PERMISSION["code_sequences"]).toBeUndefined();
    expectPassed(await run("admin", "code_sequences"));
  });
});

describe("requireEntityHistoryAccess — the per-request cache", () => {
  it("fills req.permissionCodes so a second gate costs no query", async () => {
    const { req } = await run("member", CODED_ENTITY, {
      codes: ["parts.edit"],
    });
    expect(req.permissionCodes).toEqual(["parts.edit"]);
    expect(req.permissionHasRole).toBe(true);
    expect(authz).toHaveBeenCalledTimes(1);
  });

  it("reuses a cache requirePermission already filled", async () => {
    const req = createMockRequest({
      params: { entityName: CODED_ENTITY, entityUuid: "irrelevant" },
      user: {
        userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
        email: "someone@acme.test",
        role: "member",
      },
      permissionCodes: ["audit.read"],
      permissionHasRole: true,
    }) as Request;
    const res = createMockResponse() as Response;
    const next = jest.fn() as unknown as NextFunction;

    await requireEntityHistoryAccess(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(authz).not.toHaveBeenCalled();
  });
});
