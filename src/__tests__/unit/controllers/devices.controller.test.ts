// @ts-nocheck
/**
 * DevicesController — AC-3-2..AC-3-6 as amended by gate amendment 2: approve and
 * revoke are bodyless state changes, there is no pairing code (D-147).
 *
 * What each group is built to catch if someone "simplifies" it:
 *   - the company argument dropped from the `getByUuid` call, or from the list's
 *     own guard, which turns every tenant's devices into one approver's queue
 *     (L-009, I-8). With a stubbed DAO the 404 cases cannot see that — they
 *     would answer 404 either way — so the guard is the pair of cases asserting
 *     the argument itself ("scopes an admin's lookup…", "lets a superAdmin…");
 *   - approve refusing a `revoked` row, which D-149 explicitly allows again: the
 *     admin who revoked the wrong device must be able to undo it from the list;
 *   - the audit action named after the write instead of before it, which leaves
 *     the ledger row actionless;
 *   - `approvedBy`/`revokedBy` taken from the body instead of the token (I-9).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const dao = {
  getAllWithFilters: jest.fn(),
  getByUuid: jest.fn(),
  getViewByUuid: jest.fn(),
  approve: jest.fn(),
  revoke: jest.fn(),
};
const setAuditAction = jest.fn(() => Promise.resolve());
const getIdByUuid = jest.fn();

jest.mock("../../../dao/user-device/user-device.dao", () => ({
  UserDeviceDAO: function () {
    return {
      getAllWithFilters: (...a) => dao.getAllWithFilters(...a),
      getByUuid: (...a) => dao.getByUuid(...a),
      getViewByUuid: (...a) => dao.getViewByUuid(...a),
      approve: (...a) => dao.approve(...a),
      revoke: (...a) => dao.revoke(...a),
    };
  },
}));
jest.mock("../../../database/audit-context", () => ({
  setAuditAction: (...a) => setAuditAction(...a),
}));
jest.mock("../../../utils/foreignKeyResolver", () => ({
  getIdByUuid: (...a) => getIdByUuid(...a),
}));

import { DevicesController } from "../../../controllers/devices/devices.controller";

const DEVICE_UUID = "d41a4c0e-1f4a-4d0b-9a55-0f1f9e4b1c22";
const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
// db-per-company T1/AC-7: the DAO scopes by the numeric id `resolveTenantContext`
// resolves onto the request, not the token's uuid — these stand in for that
// resolution, which this controller-level test never itself performs.
const COMPANY_A_ID = 11;
const COMPANY_B_ID = 22;
const ADMIN_UUID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = 9;

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => ((res.statusCode = code), res));
  res.json = jest.fn((payload) => ((res.body = payload), res));
  return res;
};

const admin = (companyId = COMPANY_A) => ({
  userId: ADMIN_UUID,
  email: "admin@acme.test",
  role: "admin",
  companyId,
});

const makeReq = (overrides = {}) => ({
  params: { uuid: DEVICE_UUID },
  body: undefined,
  query: {},
  user: admin(),
  // What `resolveTenantContext` would have already resolved onto the request
  // by the time a router handler runs (db-per-company T1) — the default admin's
  // numeric id, matching `admin()`'s default uuid.
  companyId: COMPANY_A_ID,
  ...overrides,
});

const pendingRow = (overrides = {}) => ({
  id: 42,
  uuid: DEVICE_UUID,
  userId: 7,
  tokenHash: "a".repeat(64),
  status: "pending",
  userAgent: "Mozilla/5.0 Chrome/128.0",
  requestIp: "190.2.14.77",
  requestedAt: new Date("2026-09-12T14:03:11.000Z"),
  approvedAt: null,
  approvedBy: null,
  revokedAt: null,
  revokedBy: null,
  createdAt: new Date("2026-09-12T14:03:11.000Z"),
  updatedAt: new Date("2026-09-12T14:03:11.000Z"),
  ...overrides,
});

const APPROVER_REF = {
  uuid: ADMIN_UUID,
  email: "admin@acme.test",
  firstName: "Ada",
  lastName: "Admin",
};

const view = (overrides = {}) => ({
  uuid: DEVICE_UUID,
  status: "approved",
  userAgent: "Mozilla/5.0 Chrome/128.0",
  requestIp: "190.2.14.77",
  requestedAt: "2026-09-12T14:03:11.000Z",
  approvedAt: "2026-09-12T14:05:40.000Z",
  revokedAt: null,
  createdAt: "2026-09-12T14:03:11.000Z",
  updatedAt: "2026-09-12T14:05:40.000Z",
  user: {
    uuid: "5f1ce0de-1111-4111-8111-aaaaaaaaaaaa",
    email: "ana@acme.test",
    firstName: "Ana",
    lastName: "Pérez",
  },
  approvedBy: APPROVER_REF,
  revokedBy: null,
  ...overrides,
});

/** Every key anywhere in the payload, for the leak sweep. */
const deepKeys = (value) => {
  if (Array.isArray(value)) return value.flatMap(deepKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [
      key,
      ...deepKeys(nested),
    ]);
  }
  return [];
};

let controller;

beforeEach(() => {
  jest.clearAllMocks();
  getIdByUuid.mockResolvedValue(ACTOR_ID);
  dao.getByUuid.mockResolvedValue(pendingRow());
  dao.getViewByUuid.mockResolvedValue(view());
  dao.approve.mockResolvedValue(pendingRow({ status: "approved" }));
  dao.revoke.mockResolvedValue(pendingRow({ status: "revoked" }));
  controller = new DevicesController();
});

describe("GET /devices (AC-3-1)", () => {
  it("returns the paginator unwrapped, built from the request itself", async () => {
    const paginator = {
      success: true,
      data: [view({ status: "pending", approvedAt: null, approvedBy: null })],
      page: 2,
      limit: 50,
      count: 1,
      totalCount: 1,
      totalPages: 1,
    };
    dao.getAllWithFilters.mockResolvedValue(paginator);
    const req = makeReq({
      query: {
        status: "pending,revoked",
        search: "ana",
        page: "2",
        limit: "50",
      },
    });
    const res = makeRes();

    await controller.getAll(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    // Unwrapped: the paginator IS the body, never `{data: paginator}`.
    expect(res.body).toBe(paginator);
    // The whole request goes to the shared builder, so no documented param can
    // be accepted and ignored (L-007).
    expect(dao.getAllWithFilters).toHaveBeenCalledWith(req);
  });
});

describe("the list cannot go unscoped (AC-3-2, I-8)", () => {
  it("answers an empty page, without a query, for a companyless non-superAdmin", async () => {
    // `companyFilterScope` answers `undefined` for this caller — the same value
    // it uses for "a superAdmin named no company" — so reaching the DAO at all
    // would list every tenant's devices (db-per-company T1/AC-7).
    const res = makeRes();

    await controller.getAll(
      makeReq({
        user: { ...admin(), companyId: undefined },
        companyId: undefined,
        query: {},
      }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [],
      page: 1,
      limit: 20,
      count: 0,
      totalCount: 0,
      totalPages: 0,
    });
    expect(dao.getAllWithFilters).not.toHaveBeenCalled();
  });

  it("echoes the requested page and limit in that empty page", async () => {
    const res = makeRes();

    await controller.getAll(
      makeReq({
        user: { ...admin(), companyId: undefined },
        query: { page: "3", limit: "5" },
      }),
      res,
      jest.fn(),
    );

    expect(res.body).toMatchObject({ page: 3, limit: 5, totalPages: 0 });
  });

  it("still queries for a superAdmin with no company filter", async () => {
    dao.getAllWithFilters.mockResolvedValue({ success: true, data: [] });

    await controller.getAll(
      makeReq({
        user: { ...admin(), role: "superAdmin", companyId: undefined },
      }),
      makeRes(),
      jest.fn(),
    );

    expect(dao.getAllWithFilters).toHaveBeenCalled();
  });
});

describe("approve transitions (AC-3-3, D-149)", () => {
  it("approves a pending device as the caller, with no body", async () => {
    const res = makeRes();

    await controller.approve(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(dao.approve).toHaveBeenCalledWith(42, ACTOR_ID);
    expect(setAuditAction).toHaveBeenCalledWith("user_device.approve");
    // The trigger reads the action at row-write time, so naming it after the
    // UPDATE would leave the ledger row actionless. Swap the two lines in the
    // controller and this reddens.
    expect(setAuditAction.mock.invocationCallOrder[0]).toBeLessThan(
      dao.approve.mock.invocationCallOrder[0],
    );
    // The re-read carries the caller's scope too: an unscoped one could answer
    // with a row this caller was never allowed to name.
    expect(dao.getViewByUuid).toHaveBeenCalledWith(DEVICE_UUID, COMPANY_A_ID);
    expect(res.body).toEqual({ success: true, data: view() });
  });

  it("answers 409 for an already approved device", async () => {
    dao.getByUuid.mockResolvedValue(
      pendingRow({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: 3,
      }),
    );
    const res = makeRes();

    await controller.approve(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Device is already approved.",
      code: "INVALID_DEVICE_TRANSITION",
    });
    expect(dao.approve).not.toHaveBeenCalled();
  });

  it("approves a revoked device — the edge exists again (D-149)", async () => {
    dao.getByUuid.mockResolvedValue(
      pendingRow({
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: 3,
      }),
    );
    const res = makeRes();

    await controller.approve(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(dao.approve).toHaveBeenCalledWith(42, ACTOR_ID);
  });
});

describe("company scope (AC-3-2, AC-3-5, I-8)", () => {
  it("scopes an admin's lookup to their own company", async () => {
    await controller.approve(makeReq(), makeRes(), jest.fn());

    expect(dao.getByUuid).toHaveBeenCalledWith(DEVICE_UUID, COMPANY_A_ID);
  });

  it("lets a superAdmin act on any company, and narrows on ?companyId=", async () => {
    const superAdmin = { ...admin(COMPANY_A), role: "superAdmin" };

    await controller.approve(
      makeReq({ user: superAdmin }),
      makeRes(),
      jest.fn(),
    );
    expect(dao.getByUuid).toHaveBeenLastCalledWith(DEVICE_UUID, undefined);

    await controller.approve(
      makeReq({
        user: superAdmin,
        query: { companyId: COMPANY_B },
        companyId: COMPANY_B_ID,
      }),
      makeRes(),
      jest.fn(),
    );
    expect(dao.getByUuid).toHaveBeenLastCalledWith(DEVICE_UUID, COMPANY_B_ID);
  });

  it("answers 404, never an unscoped read, for a companyless non-superAdmin", async () => {
    const res = makeRes();

    await controller.approve(
      makeReq({
        user: { ...admin(), companyId: undefined },
        companyId: undefined,
      }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(404);
    expect(dao.getByUuid).not.toHaveBeenCalled();
  });

  it("answers 404 for a device outside the caller's company", async () => {
    // The scope is part of the query, so a foreign row reads as absent.
    dao.getByUuid.mockResolvedValue(null);
    const res = makeRes();

    await controller.approve(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Device not found.",
      code: "DEVICE_NOT_FOUND",
    });
    expect(dao.approve).not.toHaveBeenCalled();
  });

  it("answers 404 for the same reason on revoke", async () => {
    dao.getByUuid.mockResolvedValue(null);
    const res = makeRes();

    await controller.revoke(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("DEVICE_NOT_FOUND");
    expect(dao.revoke).not.toHaveBeenCalled();
  });
});

describe("revoke transitions (AC-3-4)", () => {
  it("revokes a pending device as the caller, with no body", async () => {
    const res = makeRes();

    await controller.revoke(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(dao.revoke).toHaveBeenCalledWith(42, ACTOR_ID);
    expect(setAuditAction).toHaveBeenCalledWith("user_device.revoke");
    expect(setAuditAction.mock.invocationCallOrder[0]).toBeLessThan(
      dao.revoke.mock.invocationCallOrder[0],
    );
    expect(dao.getViewByUuid).toHaveBeenCalledWith(DEVICE_UUID, COMPANY_A_ID);
  });

  it("revokes an approved device", async () => {
    dao.getByUuid.mockResolvedValue(
      pendingRow({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: 3,
      }),
    );
    const res = makeRes();

    await controller.revoke(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(dao.revoke).toHaveBeenCalledWith(42, ACTOR_ID);
  });

  it("answers 409 for an already revoked device", async () => {
    dao.getByUuid.mockResolvedValue(
      pendingRow({
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: 3,
      }),
    );
    const res = makeRes();

    await controller.revoke(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Device is already revoked.",
      code: "INVALID_DEVICE_TRANSITION",
    });
    expect(dao.revoke).not.toHaveBeenCalled();
  });

  it("ignores an actor supplied in the body (I-9)", async () => {
    await controller.revoke(
      makeReq({ body: { revokedBy: 999, approvedBy: 999 } }),
      makeRes(),
      jest.fn(),
    );

    expect(dao.revoke).toHaveBeenCalledWith(42, ACTOR_ID);
    expect(getIdByUuid).toHaveBeenCalledWith(ADMIN_UUID, "users");
  });
});

describe("responses carry nothing internal (AC-3-6, I-10)", () => {
  const forbidden = [
    "id",
    "userId",
    "tokenHash",
    "approvedById",
    "revokedById",
  ];

  it.each([["approve"], ["revoke"]])(
    "%s answers the view and adds nothing to it",
    async (verb) => {
      const res = makeRes();

      await controller[verb](makeReq(), res, jest.fn());

      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.body)).toEqual(["success", "data"]);
      const keys = deepKeys(res.body);
      for (const key of forbidden) expect(keys).not.toContain(key);
      expect(keys.filter((key) => /Id$/.test(key))).toEqual([]);
      expect(res.body.data.approvedBy).toEqual(APPROVER_REF);
    },
  );
});
