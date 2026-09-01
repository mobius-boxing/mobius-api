// @ts-nocheck
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

/**
 * `AuditService.record` resolves the actor's numeric ids. Under P1 those ids are
 * ALREADY on the ambient state — `armAudit` resolved them once per request —
 * and re-resolving them here costs a second pooled `core` connection on top of
 * the entity's write, which measured as a high-water of 24 concurrent
 * connections against a core:12/erp:15 budget.
 *
 * These tests pin the precedence that fix depends on. Every controller test
 * mocks this service away, so without this file the reuse branch is exercised
 * by nothing.
 */

// jest.mock factories are hoisted above these declarations, so every reference
// to them must happen INSIDE a function that runs later — at construction or
// call time — never in the factory body itself.
const insert = jest.fn(() => Promise.resolve());
const getIdByUuid = jest.fn();
let ambientActor: unknown = null;

jest.mock("../../../dao/audit-log/audit-log.dao", () => ({
  __esModule: true,
  AuditLogDAO: class {
    insert(...args: unknown[]) {
      return insert(...args);
    }
  },
}));

jest.mock("../../../utils/foreignKeyResolver", () => ({
  __esModule: true,
  getIdByUuid: (...args: unknown[]) => getIdByUuid(...args),
}));

jest.mock("../../../database/audit-context", () => ({
  __esModule: true,
  getAuditState: () => (ambientActor ? { actor: ambientActor } : undefined),
}));

import { AuditService } from "../../../services/audit.service";

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const COMPANY_UUID = "22222222-2222-4222-8222-222222222222";

const req = (user: unknown) => ({ user }) as never;

describe("AuditService.record — actor resolution (P1)", () => {
  let service: AuditService;

  beforeEach(() => {
    insert.mockClear();
    getIdByUuid.mockReset();
    ambientActor = null;
    service = new AuditService();
  });

  afterEach(() => jest.restoreAllMocks());

  const row = () => insert.mock.calls[0][0];

  describe("with an ambient state — the ids are already resolved", () => {
    beforeEach(() => {
      ambientActor = {
        userId: 7,
        username: "someone@example.com",
        role: "admin",
        actorCompanyId: 99,
        companyId: 42,
      };
    });

    it("reuses the actor's ids and opens NO second connection", async () => {
      await service.record(
        req({ userId: USER_UUID, companyId: COMPANY_UUID }),
        "Customer",
        "Alta",
        { uuid: "x" },
      );

      // The whole point: not one uuid->id lookup.
      expect(getIdByUuid).not.toHaveBeenCalled();
      expect(row().userId).toBe(7);
      expect(row().companyId).toBe(42);
    });

    it("records the EFFECTIVE company for a superAdmin operating as a tenant", async () => {
      // actorCompanyId (99) is the token's own company; companyId (42) is the
      // company being operated on. Attributing the write to 99 would file it
      // under the wrong tenant.
      await service.record(
        req({ userId: USER_UUID, companyId: COMPANY_UUID }),
        "Customer",
        "Alta",
        { uuid: "x" },
      );

      expect(row().companyId).toBe(42);
      expect(row().companyId).not.toBe(99);
    });

    it("still lets the entity's own numeric companyId win", async () => {
      await service.record(
        req({ userId: USER_UUID, companyId: COMPANY_UUID }),
        "Customer",
        "Alta",
        { uuid: "x", companyId: 5 },
      );

      expect(row().companyId).toBe(5);
      expect(getIdByUuid).not.toHaveBeenCalled();
    });

    it("falls back to the lookup when the actor carries no userId", async () => {
      ambientActor = { ...ambientActor, userId: null };
      getIdByUuid.mockResolvedValue(31);

      await service.record(
        req({ userId: USER_UUID, companyId: COMPANY_UUID }),
        "Customer",
        "Alta",
        { uuid: "x" },
      );

      expect(getIdByUuid).toHaveBeenCalledWith(USER_UUID, "users");
      expect(row().userId).toBe(31);
      // The company still comes from the actor, so only ONE lookup happened.
      expect(getIdByUuid).toHaveBeenCalledTimes(1);
      expect(row().companyId).toBe(42);
    });
  });

  describe("without an ambient state — jobs, seeds, tests", () => {
    it("resolves both ids the old way", async () => {
      getIdByUuid.mockImplementation((uuid: string, table: string) =>
        Promise.resolve(table === "users" ? 31 : 77),
      );

      await service.record(
        req({ userId: USER_UUID, companyId: COMPANY_UUID }),
        "Customer",
        "Alta",
        { uuid: "x" },
      );

      expect(getIdByUuid).toHaveBeenCalledWith(USER_UUID, "users");
      expect(getIdByUuid).toHaveBeenCalledWith(COMPANY_UUID, "companies");
      expect(row().userId).toBe(31);
      expect(row().companyId).toBe(77);
    });

    it("records nulls when there is no user at all", async () => {
      await service.record(req(undefined), "Customer", "Alta", { uuid: "x" });

      expect(getIdByUuid).not.toHaveBeenCalled();
      expect(row().userId).toBeNull();
      expect(row().companyId).toBeNull();
    });
  });

  it("never propagates a failure — audit must not roll back the business write", async () => {
    insert.mockRejectedValueOnce(new Error("boom"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    ambientActor = { userId: 7, companyId: 42 };

    await expect(
      service.record(req({ userId: USER_UUID }), "Customer", "Alta", {
        uuid: "x",
      }),
    ).resolves.toBeUndefined();
  });
});
