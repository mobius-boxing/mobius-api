/**
 * `device.service` — the login/accept-invitation cases (AC-2-6, AC-2-7), the
 * gate's read (part of AC-2-1/2-3) and the secret/hash split (AC-2-9).
 *
 * What each case is built to catch:
 *   - a client-supplied hash being inserted as-is, which would let an attacker
 *     choose their own device secret (D-3, case 3 vs case 2);
 *   - a `token` leaking into a response that did not mint the secret (I-2);
 *   - an admin acquiring a device row, or a device query running for one at all
 *     (I-5);
 *   - `toDeviceSession` growing a key: it is a projection of the row, and the
 *     only key it may add is the `token` of the call that minted the secret.
 *
 * Only the DAO is stubbed: `hashToken`, `crypto.randomBytes` and the code util
 * run for real, because the hash↔secret relation is the thing under test.
 *
 * The last block drives `AuthController.login` rather than the service, because
 * I-12 ("a failed login creates or changes no device row") is a property of the
 * call site: the only way to prove it is to show the 401 path never reaches the
 * DAO, with a successful login in the same block so the absence is not absence
 * of wiring.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { AuthController } from "../../../controllers/auth/auth.controller";
import {
  DEVICE_TOKEN_HEADER,
  issueOrReuseDevice,
  normaliseDeviceToken,
  resolveDevice,
  toDeviceSession,
} from "../../../services/device.service";
import { IUserDevice } from "../../../interfaces/user-device/user-device.interfaces";
import { hashToken } from "../../../utils/tokenHash";

/** Read by the `bcryptjs` mock, so each case picks its own compare result. */
let bcryptCompare: (...args: any[]) => Promise<boolean> = async () => false;

const dao = {
  getByUserAndTokenHash: jest.fn<(...args: any[]) => Promise<any>>(),
  existsByTokenHash: jest.fn<(...args: any[]) => Promise<any>>(),
  createPending: jest.fn<(...args: any[]) => Promise<any>>(),
  rerequest: jest.fn<(...args: any[]) => Promise<any>>(),
  approve: jest.fn<(...args: any[]) => Promise<any>>(),
  revoke: jest.fn<(...args: any[]) => Promise<any>>(),
  update: jest.fn<(...args: any[]) => Promise<any>>(),
};

const userDao = {
  getUserByEmailWithCompany: jest.fn<(...args: any[]) => Promise<any>>(),
  getUserByEmail: jest.fn<(...args: any[]) => Promise<any>>(),
};

jest.mock("../../../dao/user/user.dao", () => ({
  UserDAO: class {
    getUserByEmailWithCompany(...args: any[]) {
      return userDao.getUserByEmailWithCompany(...args);
    }
    getUserByEmail(...args: any[]) {
      return userDao.getUserByEmail(...args);
    }
  },
}));

jest.mock("bcryptjs", () => ({
  compare: (...args: any[]) => bcryptCompare(...args),
  hash: async () => "hashed",
}));

jest.mock("../../../services/email.service", () => ({
  EmailService: class {},
}));

jest.mock("../../../services/rbac.service", () => ({
  RbacService: { permissionCodesForUserUuid: async () => [] },
}));

jest.mock("../../../dao/user-device/user-device.dao", () => ({
  // The delegation is resolved per call, so `jest.config.js`'s `resetMocks`
  // cannot leave the service holding a dead reference. Every write method of the
  // real DAO is delegated, including the ones the service must never call: an
  // unreachable spy makes a "writes nothing" assertion unfalsifiable (D-155).
  UserDeviceDAO: class {
    getByUserAndTokenHash(...args: any[]) {
      return dao.getByUserAndTokenHash(...args);
    }
    existsByTokenHash(...args: any[]) {
      return dao.existsByTokenHash(...args);
    }
    createPending(...args: any[]) {
      return dao.createPending(...args);
    }
    rerequest(...args: any[]) {
      return dao.rerequest(...args);
    }
    approve(...args: any[]) {
      return dao.approve(...args);
    }
    revoke(...args: any[]) {
      return dao.revoke(...args);
    }
    update(...args: any[]) {
      return dao.update(...args);
    }
  },
}));

const MEMBER = {
  id: 7,
  uuid: "5f1c0a34-6c2e-4a1e-9a2b-0d5f6c7e8a90",
  role: "member" as const,
};
const ADMIN = { id: 3, role: "admin" as const };
const SUPER_ADMIN = { id: 1, role: "superAdmin" as const };

const KNOWN_SECRET = "a".repeat(64);
const REQUESTED_AT = new Date("2026-09-12T14:03:11.000Z");
/** A re-request resets `requestedAt`, so case 1b can be told from case 1. */
const RE_REQUESTED_AT = new Date("2026-09-12T15:47:02.000Z");

const deviceRow = (overrides: Partial<IUserDevice> = {}): IUserDevice => ({
  id: 42,
  uuid: "d41a4c0e-1f4a-4d0b-9a55-0f1f9e4b1c22",
  userId: MEMBER.id,
  tokenHash: hashToken(KNOWN_SECRET),
  status: "pending",
  userAgent: "Mozilla/5.0",
  requestIp: "190.2.14.77",
  requestedAt: REQUESTED_AT,
  approvedAt: null,
  approvedBy: null,
  revokedAt: null,
  revokedBy: null,
  ...overrides,
});

const loginRequest = (
  header?: string,
  overrides: Record<string, unknown> = {},
): Request =>
  ({
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0",
      ...(header === undefined ? {} : { [DEVICE_TOKEN_HEADER]: header }),
    },
    ip: "190.2.14.77",
    ...overrides,
  }) as unknown as Request;

/** The single `createPending` payload, for a test that expects exactly one. */
const createdPayload = () => {
  expect(dao.createPending).toHaveBeenCalledTimes(1);
  return dao.createPending.mock.calls[0][0] as {
    userId: number;
    tokenHash: string;
    userAgent: string | null;
    requestIp: string | null;
  };
};

const writeSpies = () => [
  dao.createPending,
  dao.rerequest,
  dao.approve,
  dao.revoke,
  dao.update,
];

beforeEach(() => {
  dao.getByUserAndTokenHash.mockResolvedValue(null);
  dao.existsByTokenHash.mockResolvedValue(false);
  dao.createPending.mockImplementation(async (input: any) =>
    deviceRow({ tokenHash: input.tokenHash }),
  );
  dao.rerequest.mockResolvedValue(
    deviceRow({ status: "pending", requestedAt: RE_REQUESTED_AT }),
  );
});

describe("normaliseDeviceToken", () => {
  it("accepts only a 64-char lowercase hex secret", () => {
    expect(normaliseDeviceToken(KNOWN_SECRET)).toBe(KNOWN_SECRET);
    expect(normaliseDeviceToken(KNOWN_SECRET.toUpperCase())).toBeNull();
    expect(normaliseDeviceToken("a".repeat(63))).toBeNull();
    expect(normaliseDeviceToken("not-a-secret")).toBeNull();
    expect(normaliseDeviceToken(undefined)).toBeNull();
    expect(normaliseDeviceToken(12345)).toBeNull();
    expect(normaliseDeviceToken([KNOWN_SECRET])).toBe(KNOWN_SECRET);
  });
});

describe("toDeviceSession", () => {
  it("projects the row's own columns, whatever the status", () => {
    expect(
      toDeviceSession(
        deviceRow({ status: "approved", approvedAt: REQUESTED_AT }),
      ),
    ).toEqual({
      uuid: "d41a4c0e-1f4a-4d0b-9a55-0f1f9e4b1c22",
      status: "approved",
      requestedAt: REQUESTED_AT,
      approvedAt: REQUESTED_AT,
      revokedAt: null,
    });
    expect(
      toDeviceSession(
        deviceRow({ status: "revoked", revokedAt: REQUESTED_AT }),
      ),
    ).toMatchObject({ status: "revoked", revokedAt: REQUESTED_AT });
  });

  it("omits `token` unless the caller minted the secret (I-2)", () => {
    expect("token" in toDeviceSession(deviceRow())).toBe(false);
    expect(toDeviceSession(deviceRow(), KNOWN_SECRET).token).toBe(KNOWN_SECRET);
  });

  it("never emits an internal column", () => {
    expect(Object.keys(toDeviceSession(deviceRow())).sort()).toEqual([
      "approvedAt",
      "requestedAt",
      "revokedAt",
      "status",
      "uuid",
    ]);
  });
});

describe("issueOrReuseDevice (AC-2-6)", () => {
  it("case 1: reuses an approved row without a token", async () => {
    const row = deviceRow({
      status: "approved",
      approvedAt: REQUESTED_AT,
      approvedBy: 3,
    });
    dao.getByUserAndTokenHash.mockResolvedValue(row);

    const session = await issueOrReuseDevice(
      MEMBER,
      loginRequest(KNOWN_SECRET),
    );

    expect(session).toMatchObject({ status: "approved" });
    expect("token" in session!).toBe(false);
    expect(dao.getByUserAndTokenHash).toHaveBeenCalledWith(
      MEMBER.id,
      hashToken(KNOWN_SECRET),
    );
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it("case 1: reuses a pending row untouched", async () => {
    dao.getByUserAndTokenHash.mockResolvedValue(deviceRow());

    const session = await issueOrReuseDevice(
      MEMBER,
      loginRequest(KNOWN_SECRET),
    );

    expect(session).toMatchObject({
      status: "pending",
      requestedAt: REQUESTED_AT,
    });
    expect(dao.rerequest).not.toHaveBeenCalled();
  });

  it("case 1b: re-requests a revoked row and returns the re-requested one", async () => {
    dao.getByUserAndTokenHash.mockResolvedValue(
      deviceRow({
        status: "revoked",
        approvedAt: REQUESTED_AT,
        approvedBy: 3,
        revokedAt: REQUESTED_AT,
        revokedBy: 3,
      }),
    );

    const session = await issueOrReuseDevice(
      MEMBER,
      loginRequest(KNOWN_SECRET),
    );

    expect(dao.rerequest).toHaveBeenCalledWith(42, {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0",
      requestIp: "190.2.14.77",
    });
    expect(session).toMatchObject({
      status: "pending",
      requestedAt: RE_REQUESTED_AT,
    });
    expect("token" in session!).toBe(false);
    expect(dao.createPending).not.toHaveBeenCalled();
  });

  it("case 2: adopts a hash another user already carries, without a token", async () => {
    dao.existsByTokenHash.mockResolvedValue(true);

    const session = await issueOrReuseDevice(
      MEMBER,
      loginRequest(KNOWN_SECRET),
    );

    expect(createdPayload()).toMatchObject({
      userId: MEMBER.id,
      tokenHash: hashToken(KNOWN_SECRET),
    });
    expect("token" in session!).toBe(false);
    expect(session!.status).toBe("pending");
  });

  it("case 3: mints a secret when no header is sent", async () => {
    const session = await issueOrReuseDevice(MEMBER, loginRequest());

    const secret = session!.token as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // AC-2-9: the DB gets sha256(secret), never the secret itself.
    expect(createdPayload().tokenHash).toBe(hashToken(secret));
    expect(createdPayload().tokenHash).not.toBe(secret);
    expect(dao.getByUserAndTokenHash).not.toHaveBeenCalled();
  });

  it("case 3: ignores a malformed header instead of storing it (D-3)", async () => {
    const session = await issueOrReuseDevice(MEMBER, loginRequest("bogus"));

    expect(createdPayload().tokenHash).toBe(
      hashToken(session!.token as string),
    );
    expect(createdPayload().tokenHash).not.toBe(hashToken("bogus"));
    expect(dao.getByUserAndTokenHash).not.toHaveBeenCalled();
  });

  it("case 3: a well-formed hash nobody carries is not adopted (D-3)", async () => {
    dao.existsByTokenHash.mockResolvedValue(false);

    const session = await issueOrReuseDevice(
      MEMBER,
      loginRequest(KNOWN_SECRET),
    );

    expect(session!.token).toBeDefined();
    expect(session!.token).not.toBe(KNOWN_SECRET);
    expect(createdPayload().tokenHash).not.toBe(hashToken(KNOWN_SECRET));
  });

  it("truncates the user agent and ip to their column widths", async () => {
    await issueOrReuseDevice(
      MEMBER,
      loginRequest(undefined, {
        headers: { "user-agent": "U".repeat(600) },
        ip: "F".repeat(60),
      }),
    );

    expect(createdPayload().userAgent).toHaveLength(512);
    expect(createdPayload().requestIp).toHaveLength(45);
  });

  it("stores null when the browser sends neither (D-11)", async () => {
    await issueOrReuseDevice(
      MEMBER,
      loginRequest(undefined, { headers: {}, ip: undefined }),
    );

    expect(createdPayload()).toMatchObject({
      userAgent: null,
      requestIp: null,
    });
  });

  it("throws rather than answering a revoked session when the re-request hits no row", async () => {
    dao.getByUserAndTokenHash.mockResolvedValue(
      deviceRow({
        status: "revoked",
        revokedAt: new Date(),
      }),
    );
    dao.rerequest.mockResolvedValue(null);

    await expect(
      issueOrReuseDevice(MEMBER, loginRequest(KNOWN_SECRET)),
    ).rejects.toThrow("device re-request updated no row");
  });

  it("refuses to write without a numeric users.id", async () => {
    await expect(
      issueOrReuseDevice({ role: "member" }, loginRequest()),
    ).rejects.toThrow("device lookup needs users.id");

    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", ADMIN],
    ["superAdmin", SUPER_ADMIN],
  ])("AC-2-7: a %s gets no device and no query", async (_role, user) => {
    expect(
      await issueOrReuseDevice(user, loginRequest(KNOWN_SECRET)),
    ).toBeNull();

    expect(dao.getByUserAndTokenHash).not.toHaveBeenCalled();
    expect(dao.existsByTokenHash).not.toHaveBeenCalled();
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });
});

describe("resolveDevice", () => {
  it.each(["pending", "approved", "revoked"] as const)(
    "projects a %s row and writes nothing (I-3)",
    async (status) => {
      dao.getByUserAndTokenHash.mockResolvedValue(deviceRow({ status }));

      const session = await resolveDevice(MEMBER, KNOWN_SECRET);

      expect(session!.status).toBe(status);
      for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
    },
  );

  it("answers null for an unknown hash, and never queries without a usable header", async () => {
    expect(await resolveDevice(MEMBER, KNOWN_SECRET)).toBeNull();
    expect(dao.getByUserAndTokenHash).toHaveBeenCalledTimes(1);

    expect(await resolveDevice(MEMBER, undefined)).toBeNull();
    expect(await resolveDevice(MEMBER, "bogus")).toBeNull();
    expect(dao.getByUserAndTokenHash).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["admin", ADMIN],
    ["superAdmin", SUPER_ADMIN],
  ])("AC-2-3: never queries for a %s", async (_role, user) => {
    expect(await resolveDevice(user, KNOWN_SECRET)).toBeNull();
    expect(dao.getByUserAndTokenHash).not.toHaveBeenCalled();
  });

  it("degrades to an unresolved device only when the table is missing", async () => {
    // The deploy window where `user_devices` does not exist yet: every
    // authenticated route must answer 403, not 500 (Rollout step 1).
    dao.getByUserAndTokenHash.mockRejectedValue(
      Object.assign(new Error('relation "user_devices" does not exist'), {
        code: "42P01",
      }),
    );
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(await resolveDevice(MEMBER, KNOWN_SECRET)).toBeNull();

    // AC-2-9: the presented secret is never logged; the user uuid is.
    expect(String(logged.mock.calls[0])).not.toContain(KNOWN_SECRET);
    expect(String(logged.mock.calls[0])).toContain(MEMBER.uuid);
    logged.mockRestore();
  });

  it.each([
    ["a pool exhaustion", { code: "53300" }],
    ["an undefined binding", {}],
  ])(
    "propagates %s instead of logging the member out",
    async (_case, extra) => {
      // A swallowed failure answers 403 DEVICE_UNKNOWN, which makes the SPA clear
      // the session: the member is logged out and cannot log back in for as long
      // as the fault lasts. A 500 leaves the session alone.
      dao.getByUserAndTokenHash.mockRejectedValue(
        Object.assign(new Error("boom"), extra),
      );

      await expect(resolveDevice(MEMBER, KNOWN_SECRET)).rejects.toThrow("boom");
    },
  );

  it("refuses to query without a numeric users.id", async () => {
    await expect(
      resolveDevice({ role: "member" }, KNOWN_SECRET),
    ).rejects.toThrow("device lookup needs users.id");

    expect(dao.getByUserAndTokenHash).not.toHaveBeenCalled();
  });
});

describe("I-12 — a failed login touches no device row", () => {
  const runLogin = async () => {
    const req = {
      body: { email: "ana@acme.test", password: "whatever" },
      headers: { "user-agent": "Mozilla/5.0" },
      ip: "190.2.14.77",
    } as unknown as Request;
    const json = jest.fn<(body: any) => void>();
    const res = {
      status: jest.fn(() => ({ json })),
    } as unknown as Response;
    const next = jest.fn();

    await new AuthController().login(req, res, next as any);

    return { json, res, next };
  };

  beforeEach(() => {
    userDao.getUserByEmailWithCompany.mockResolvedValue({
      id: MEMBER.id,
      uuid: MEMBER.uuid,
      email: "ana@acme.test",
      role: "member",
      isActive: true,
    });
    userDao.getUserByEmail.mockResolvedValue({
      id: MEMBER.id,
      email: "ana@acme.test",
      password: "$2a$12$storedhash",
      role: "member",
    });
  });

  it("creates nothing when the password is wrong", async () => {
    bcryptCompare = async () => false;

    const { res } = await runLogin();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(dao.getByUserAndTokenHash).not.toHaveBeenCalled();
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it("does create one on a successful login (so the case above is not vacuous)", async () => {
    bcryptCompare = async () => true;

    const { json, res } = await runLogin();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(dao.createPending).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0][0].data.device).toMatchObject({
      status: "pending",
    });
    expect(json.mock.calls[0][0].data.device.token).toMatch(/^[0-9a-f]{64}$/);
  });
});
