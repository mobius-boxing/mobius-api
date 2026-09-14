/**
 * Device policy for the `X-Device-Token` transport: resolution for the gate and
 * the four login cases, in one place (D-24). `authenticate`, `login` and
 * `acceptInvitation` all need the same answers, and none of them may own them —
 * a second copy of "is this browser known to this user" is how one caller ends
 * up trusting a client-supplied hash.
 */
import crypto from "crypto";
import { Request } from "express";
import {
  DeviceRequestContext,
  UserDeviceDAO,
} from "../dao/user-device/user-device.dao";
import {
  IDeviceSession,
  IUserDevice,
} from "../interfaces/user-device/user-device.interfaces";
import { hashToken } from "../utils/tokenHash";

/** Node lowercases incoming header names. */
export const DEVICE_TOKEN_HEADER = "x-device-token";

/**
 * The `users` fields the device logic reads. `id` and `role` come from the row
 * the caller loaded, never from a JWT claim: a token claiming `admin` must not
 * be able to opt out of the gate (I-5). `uuid` is diagnostics only — it is never
 * part of a query.
 */
export type DeviceUser = {
  id?: number;
  uuid?: string;
  role: "member" | "admin" | "superAdmin";
};

const SECRET_BYTES = 32;

/** The server only ever issues `randomBytes(32).toString("hex")` (D-24). */
const DEVICE_SECRET_PATTERN = /^[0-9a-f]{64}$/;

/** PostgreSQL `undefined_table` — the only failure the gate may swallow. */
const UNDEFINED_TABLE = "42P01";

const USER_AGENT_MAX = 512;
const REQUEST_IP_MAX = 45;

const deviceDAO = new UserDeviceDAO();

export const isDeviceGatedRole = (role: DeviceUser["role"]): boolean =>
  role === "member";

/** A header that is absent or not a server-issued secret counts as absent. */
export function normaliseDeviceToken(header: unknown): string | null {
  const value = Array.isArray(header) ? header[0] : header;

  return typeof value === "string" && DEVICE_SECRET_PATTERN.test(value)
    ? value
    : null;
}

/**
 * The row as its own user may see it. `rawSecret` is passed only by the call
 * that issued it: the server stores the hash and can never reproduce the secret
 * afterwards (I-2).
 */
export function toDeviceSession(
  row: IUserDevice,
  rawSecret?: string,
): IDeviceSession {
  return {
    uuid: row.uuid as string,
    status: row.status,
    requestedAt: row.requestedAt,
    approvedAt: row.approvedAt,
    revokedAt: row.revokedAt,
    ...(rawSecret ? { token: rawSecret } : {}),
  };
}

/**
 * The gate's read. Never writes (I-3); `null` means "no approved-or-not row for
 * this (user, browser)" and the gate turns that into `DEVICE_UNKNOWN`.
 */
export async function resolveDevice(
  user: DeviceUser,
  header: unknown,
): Promise<IDeviceSession | null> {
  if (!isDeviceGatedRole(user.role)) return null;

  const secret = normaliseDeviceToken(header);
  if (!secret) return null;

  const userId = requireUserId(user);
  try {
    const row = await deviceDAO.getByUserAndTokenHash(
      userId,
      hashToken(secret),
    );

    return row ? toDeviceSession(row) : null;
  } catch (err) {
    // A deploy swaps containers ~30 s BEFORE the migrations run, so this code
    // can reach a database where `user_devices` does not exist yet — and only
    // that cause may be swallowed. Every other failure must surface as a 500:
    // the SPA answers 403 DEVICE_UNKNOWN by clearing the session, so a
    // swallowed pool or binding error would log every member out and keep them
    // out, while a 500 leaves the session alone and heals when the fault does.
    if ((err as { code?: string }).code !== UNDEFINED_TABLE) throw err;

    // The secret is never logged; the user uuid is what a support thread needs.
    console.error(
      `Device resolution skipped — user_devices is missing (user ${user.uuid ?? user.id})`,
    );
    return null;
  }
}

/**
 * The login / accept-invitation write. Returns `null` for a role that is never
 * gated, and for a member always a session (I-7) whose `token` is present only
 * when this call minted the secret.
 */
export async function issueOrReuseDevice(
  user: DeviceUser,
  req: Request,
): Promise<IDeviceSession | null> {
  if (!isDeviceGatedRole(user.role)) return null;

  const userId = requireUserId(user);
  const context = requestContext(req);
  const presented = normaliseDeviceToken(req.headers[DEVICE_TOKEN_HEADER]);

  if (presented) {
    const tokenHash = hashToken(presented);
    const own = await deviceDAO.getByUserAndTokenHash(userId, tokenHash);

    if (own) {
      if (own.status !== "revoked") return toDeviceSession(own);

      const rerequested = await deviceDAO.rerequest(own.id as number, context);
      // The row was read one statement ago, so an empty update means it was
      // deleted concurrently. Reporting the row as read instead would answer a
      // `revoked` session from login, which the contract forbids.
      if (!rerequested) throw new Error("device re-request updated no row");

      return toDeviceSession(rerequested);
    }

    // Only a hash some row already carries may be adopted for a new row (D-3):
    // otherwise a caller could choose their own device secret and hand it to
    // whoever they liked.
    if (await deviceDAO.existsByTokenHash(tokenHash)) {
      const shared = await deviceDAO.createPending({
        userId,
        tokenHash,
        ...context,
      });

      return toDeviceSession(shared);
    }
  }

  const secret = crypto.randomBytes(SECRET_BYTES).toString("hex");
  const issued = await deviceDAO.createPending({
    userId,
    tokenHash: hashToken(secret),
    ...context,
  });

  return toDeviceSession(issued, secret);
}

/**
 * Every device row is keyed by the numeric `users.id`, and knex turns an
 * `undefined` binding into an opaque throw. Fail loudly here instead: a missing
 * id means the caller handed over something that is not a `users` row.
 */
const requireUserId = (user: DeviceUser): number => {
  if (!Number.isInteger(user.id)) {
    throw new Error("device lookup needs users.id");
  }

  return user.id as number;
};

/**
 * `userAgent` is varchar(512) and `requestIp` varchar(45). With `trust proxy = 1`
 * (L-004) `req.ip` is read off `X-Forwarded-For`, so its length is as
 * caller-controlled as the user agent's, and an over-long value would fail the
 * insert — which would turn a header into a failed login.
 */
const requestContext = (req: Request): DeviceRequestContext => ({
  userAgent: truncate(req.headers["user-agent"], USER_AGENT_MAX),
  requestIp: truncate(req.ip, REQUEST_IP_MAX),
});

const truncate = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
