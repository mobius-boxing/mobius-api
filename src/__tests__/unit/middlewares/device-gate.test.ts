/**
 * The device gate inside `authenticate` — AC-2-1 (three codes, verbatim
 * messages, nothing but the error envelope in the body), AC-2-2/AC-2-3 (the role
 * comes from the `users` row, not the JWT claim), AC-2-4 (the exempt set is
 * exactly five `METHOD path` pairs, gate amendment 3 having added
 * `POST /api/auth/device`) and AC-2-5 (the gate writes nothing).
 *
 * The harness is `integration/cookie-auth-rejection.test.ts`'s — the real
 * middleware on a throwaway Express app — with one addition that is load-bearing:
 * the routes are mounted through a **nested router** at `/api/auth`, exactly as
 * `app.ts` mounts them. Inside a router `req.path` is relative to the mount, so
 * a gate matching on `req.path` alone would read `GET /device` and exempt that
 * path on every router in the API; with the production mount in the harness,
 * that mutation turns the exempt cases red instead of passing (L-018).
 *
 * Mutation checks recorded for this suite:
 *   - drop `req.baseUrl` from the exempt key ⇒ the four exempt cases 403;
 *   - drop the exempt-set check ⇒ the same four 403;
 *   - read the role from `decoded.role` ⇒ "a member JWT claiming admin is still
 *     gated" passes a pending member through;
 *   - drop the `isDeviceGatedRole` condition in `optionalAuth` ⇒ the unapproved
 *     member is handed a `req.user` (D-17).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import * as jwt from "jsonwebtoken";
import {
  authenticate,
  DEVICE_GATE_EXEMPT,
  optionalAuth,
} from "../../../middlewares/auth.middleware";
import { IUserDevice } from "../../../interfaces/user-device/user-device.interfaces";
import { hashToken } from "../../../utils/tokenHash";

const userDao = { getByUuid: jest.fn<(...args: any[]) => Promise<any>>() };

const deviceDao = {
  getByUserAndTokenHash: jest.fn<(...args: any[]) => Promise<any>>(),
  existsByTokenHash: jest.fn<(...args: any[]) => Promise<any>>(),
  createPending: jest.fn<(...args: any[]) => Promise<any>>(),
  rerequest: jest.fn<(...args: any[]) => Promise<any>>(),
  approve: jest.fn<(...args: any[]) => Promise<any>>(),
  revoke: jest.fn<(...args: any[]) => Promise<any>>(),
  update: jest.fn<(...args: any[]) => Promise<any>>(),
  create: jest.fn<(...args: any[]) => Promise<any>>(),
  delete: jest.fn<(...args: any[]) => Promise<any>>(),
};

jest.mock("../../../dao/user/user.dao", () => ({
  UserDAO: class {
    getByUuid(...args: any[]) {
      return userDao.getByUuid(...args);
    }
  },
}));

/**
 * Every method of the real DAO is delegated, not just the two the gate is
 * expected to call: a spy the fake cannot reach is a "writes nothing" assertion
 * that can never fail (D-155).
 */
jest.mock("../../../dao/user-device/user-device.dao", () => ({
  UserDeviceDAO: class {
    getByUserAndTokenHash(...args: any[]) {
      return deviceDao.getByUserAndTokenHash(...args);
    }
    existsByTokenHash(...args: any[]) {
      return deviceDao.existsByTokenHash(...args);
    }
    createPending(...args: any[]) {
      return deviceDao.createPending(...args);
    }
    rerequest(...args: any[]) {
      return deviceDao.rerequest(...args);
    }
    approve(...args: any[]) {
      return deviceDao.approve(...args);
    }
    revoke(...args: any[]) {
      return deviceDao.revoke(...args);
    }
    create(...args: any[]) {
      return deviceDao.create(...args);
    }
    update(...args: any[]) {
      return deviceDao.update(...args);
    }
    delete(...args: any[]) {
      return deviceDao.delete(...args);
    }
  },
}));

const USER_UUID = "5f1c0a34-6c2e-4a1e-9a2b-0d5f6c7e8a90";
const SECRET = "b".repeat(64);

type Role = "member" | "admin" | "superAdmin";

/**
 * `/api/auth` carries the five exempt routes plus several deliberate
 * near-misses (a trailing slash, a different method on an exempt path);
 * `/api/users` is the stand-in for every gated route in the API.
 */
const buildApp = () => {
  const app = express();
  const echo = (req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, device: req.device ?? null });

  const authRouter = express.Router();
  for (const path of ["/me", "/profile", "/device", "/change-password"]) {
    authRouter.get(path, authenticate, echo);
    authRouter.post(path, authenticate, echo);
  }
  // A near-miss on the exempt set: `POST /api/auth/device` is exempt (gate
  // amendment 3), but no other method on that same path is.
  authRouter.put("/device", authenticate, echo);
  authRouter.get("/logout", authenticate, echo);
  authRouter.post("/logout", authenticate, echo);
  app.use("/api/auth", authRouter);

  const usersRouter = express.Router();
  usersRouter.get("/", authenticate, echo);
  app.use("/api/users", usersRouter);

  return app;
};

const tokenFor = (claimedRole: Role) =>
  jwt.sign(
    { userId: USER_UUID, email: "ana@acme.test", role: claimedRole },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" },
  );

const deviceRow = (status: IUserDevice["status"]): IUserDevice => ({
  id: 42,
  uuid: "d41a4c0e-1f4a-4d0b-9a55-0f1f9e4b1c22",
  userId: 7,
  tokenHash: hashToken(SECRET),
  status,
  userAgent: "Mozilla/5.0",
  requestIp: "190.2.14.77",
  requestedAt: new Date("2026-09-12T14:03:11.000Z"),
  approvedAt: status === "approved" ? new Date() : null,
  approvedBy: status === "approved" ? 3 : null,
  revokedAt: status === "revoked" ? new Date() : null,
  revokedBy: status === "revoked" ? 3 : null,
});

type Options = {
  rowRole?: Role;
  claimedRole?: Role;
  status?: IUserDevice["status"] | null;
  header?: string | null;
  method?: "get" | "post" | "put";
};

const call = async (path: string, options: Options = {}) => {
  const {
    rowRole = "member",
    claimedRole = rowRole,
    status = null,
    header = SECRET,
    method = "get",
  } = options;

  userDao.getByUuid.mockResolvedValue({
    id: 7,
    uuid: USER_UUID,
    email: "ana@acme.test",
    role: rowRole,
    isActive: true,
  });
  deviceDao.getByUserAndTokenHash.mockResolvedValue(
    status === null ? null : deviceRow(status),
  );

  const pending = request(buildApp())
    [method](path)
    .set("Authorization", `Bearer ${tokenFor(claimedRole)}`);

  return header === null ? pending : pending.set("X-Device-Token", header);
};

const writeSpies = () => [
  deviceDao.createPending,
  deviceDao.rerequest,
  deviceDao.approve,
  deviceDao.revoke,
  deviceDao.update,
  deviceDao.create,
  deviceDao.delete,
];

beforeEach(() => {
  deviceDao.getByUserAndTokenHash.mockResolvedValue(null);
});

describe("AC-2-1 — the three rejection codes and their messages", () => {
  it.each([
    [
      "no header at all",
      { header: null },
      "DEVICE_UNKNOWN",
      "This device is not registered for your account. Please log in again.",
    ],
    [
      "a malformed header",
      { header: "not-a-device-token" },
      "DEVICE_UNKNOWN",
      "This device is not registered for your account. Please log in again.",
    ],
    [
      "a header no row carries",
      { status: null },
      "DEVICE_UNKNOWN",
      "This device is not registered for your account. Please log in again.",
    ],
    [
      "a pending row",
      { status: "pending" as const },
      "DEVICE_PENDING",
      "This device is waiting for an administrator's approval.",
    ],
    [
      "a revoked row",
      { status: "revoked" as const },
      "DEVICE_REVOKED",
      "This device has been revoked. Log in again to request access.",
    ],
  ])("403s a member with %s", async (_case, options, code, message) => {
    const res = await call("/api/users", options as Options);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message, code });
  });

  it("answers the plain error envelope and nothing else", async () => {
    const res = await call("/api/users", { status: "pending" });

    expect(Object.keys(res.body).sort()).toEqual([
      "code",
      "message",
      "success",
    ]);
  });

  it("lets an approved device through", async () => {
    const res = await call("/api/users", { status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.device).toMatchObject({ status: "approved" });
  });
});

describe("AC-2-2 / AC-2-3 — the role comes from the users row", () => {
  it("still gates a member whose JWT claims admin", async () => {
    const res = await call("/api/users", {
      rowRole: "member",
      claimedRole: "admin",
      status: "pending",
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DEVICE_PENDING");
  });

  it.each(["admin", "superAdmin"] as const)(
    "never queries a device for a %s, even on a member-claiming token",
    async (rowRole) => {
      const res = await call("/api/users", { rowRole, claimedRole: "member" });

      expect(res.status).toBe(200);
      expect(res.body.device).toBeNull();
      expect(deviceDao.getByUserAndTokenHash).not.toHaveBeenCalled();
    },
  );
});

describe("AC-2-4 — the exempt set", () => {
  it("is exactly the five routes of D-22 and gate amendment 3 (D-230)", () => {
    expect([...DEVICE_GATE_EXEMPT].sort()).toEqual([
      "GET /api/auth/device",
      "GET /api/auth/me",
      "GET /api/auth/profile",
      "POST /api/auth/device",
      "POST /api/auth/logout",
    ]);
  });

  it.each([
    ["/api/auth/me", "get"],
    ["/api/auth/profile", "get"],
    ["/api/auth/device", "get"],
    ["/api/auth/device", "post"],
    ["/api/auth/logout", "post"],
  ] as const)("lets a pending member reach %s %s", async (path, method) => {
    const res = await call(path, { status: "pending", method });

    expect(res.status).toBe(200);
    expect(res.body.device).toMatchObject({ status: "pending" });
  });

  it.each([
    ["a gated route", "/api/users", "get"],
    ["change-password", "/api/auth/change-password", "post"],
    ["the exempt GET path with a trailing slash", "/api/auth/device/", "get"],
    ["the exempt POST path with a trailing slash", "/api/auth/device/", "post"],
    [
      "the exempt path with an unexempt method (PUT)",
      "/api/auth/device",
      "put",
    ],
    ["logout with another method", "/api/auth/logout", "get"],
    ["me with another method", "/api/auth/me", "post"],
  ] as const)("gates %s", async (_case, path, method) => {
    const res = await call(path, { status: "pending", method });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DEVICE_PENDING");
  });
});

describe("AC-2-5 — the gate writes nothing (I-3)", () => {
  it.each([
    ["a rejection", { status: "pending" as const }],
    ["a pass", { status: "approved" as const }],
    ["an unresolved device", { header: null }],
  ])("calls no DAO write on %s", async (_case, options) => {
    await call("/api/users", options as Options);

    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * D-17 — `optionalAuth` is mounted nowhere today, which is exactly why it is
 * tested: the first route that adopts it must not be the one door past the gate.
 */
describe("D-17 — optionalAuth treats an unapproved member as anonymous", () => {
  const buildOptionalApp = () => {
    const app = express();
    app.get("/api/ping", optionalAuth, (req, res) => {
      res.status(200).json({
        user: req.user ?? null,
        device: req.device ?? null,
      });
    });
    return app;
  };

  const ping = async (options: Options = {}) => {
    const { rowRole = "member", status = null, header = SECRET } = options;

    userDao.getByUuid.mockResolvedValue({
      id: 7,
      uuid: USER_UUID,
      email: "ana@acme.test",
      role: rowRole,
      isActive: true,
    });
    deviceDao.getByUserAndTokenHash.mockResolvedValue(
      status === null ? null : deviceRow(status),
    );

    return request(buildOptionalApp())
      .get("/api/ping")
      .set("Authorization", `Bearer ${tokenFor(rowRole)}`)
      .set("X-Device-Token", header as string);
  };

  it.each(["pending", "revoked"] as const)(
    "leaves req.user unset for a %s device but still reports the device",
    async (status) => {
      const res = await ping({ status });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.device).toMatchObject({ status });
    },
  );

  it("leaves req.user unset when no row matches the header", async () => {
    const res = await ping({ status: null });

    expect(res.body.user).toBeNull();
    expect(res.body.device).toBeNull();
  });

  it("sets req.user for an approved member", async () => {
    const res = await ping({ status: "approved" });

    expect(res.body.user).toMatchObject({ role: "member" });
    expect(res.body.device).toMatchObject({ status: "approved" });
  });

  it("sets req.user for an admin and resolves no device", async () => {
    const res = await ping({ rowRole: "admin" });

    expect(res.body.user).toMatchObject({ role: "admin" });
    expect(res.body.device).toBeNull();
    expect(deviceDao.getByUserAndTokenHash).not.toHaveBeenCalled();
  });
});
