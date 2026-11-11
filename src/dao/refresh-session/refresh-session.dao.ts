import crypto from "crypto";
import { Knex } from "knex";
import { db } from "../../database/registry";
import {
  IRefreshSession,
  RefreshOutcome,
  RefreshRevokedReason,
} from "../../interfaces/refresh-session/refresh-session.interfaces";
import { hashToken } from "../../utils/tokenHash";

const TABLE = "refresh_sessions";

const RAW_TOKEN_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[0-9a-f]{64}$/;

export type SessionLifetimes = {
  idleSeconds: number;
  absoluteSeconds: number;
  graceSeconds: number;
};

export type CreateSessionInput = {
  userId: number;
  deviceId: number | null;
};

/**
 * The raw token is `<session uuid>.<64 hex>` (A-1). The prefix is not a secret:
 * it only lets a stale token name the session it came from, so reuse of any
 * generation — not just the previous one — is caught and revokes the session.
 */
const mintToken = (sessionUuid: string): string =>
  `${sessionUuid}.${crypto.randomBytes(32).toString("hex")}`;

/** Session uuid of a well-formed raw token; null for anything else (treated as absent). */
export const parseRefreshToken = (
  raw: string | undefined | null,
): string | null => {
  if (!raw) return null;
  const match = RAW_TOKEN_PATTERN.exec(raw);
  return match ? match[1] : null;
};

export class RefreshSessionDAO {
  private knex(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? db("core");
  }

  async create(
    input: CreateSessionInput,
    lifetimes: SessionLifetimes,
    trx?: Knex.Transaction,
  ): Promise<{ session: IRefreshSession; rawToken: string }> {
    const uuid = crypto.randomUUID();
    const rawToken = mintToken(uuid);
    const knex = this.knex(trx);
    const [session] = await knex(TABLE)
      .insert({
        uuid,
        userId: input.userId,
        deviceId: input.deviceId,
        tokenHash: hashToken(rawToken),
        expiresAt: knex.raw("now() + make_interval(secs => ?)", [
          lifetimes.idleSeconds,
        ]),
        absoluteExpiresAt: knex.raw("now() + make_interval(secs => ?)", [
          lifetimes.absoluteSeconds,
        ]),
      })
      .returning("*");
    return { session, rawToken };
  }

  /** The one door controllers use to open a core transaction for session work. */
  transaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return db("core").transaction(fn);
  }

  /** Alive = not revoked and not past either deadline. The one definition of "alive". */
  async findAliveByUuid(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<IRefreshSession | null> {
    const row = await this.knex(trx)(TABLE)
      .where({ uuid })
      .whereNull("revokedAt")
      .whereRaw('"expiresAt" > now()')
      .first();
    return row ?? null;
  }

  /**
   * One refresh attempt. Must run inside the caller's core transaction: the row
   * is locked `FOR UPDATE`, so racing refreshes of one session serialize here and
   * each sees the previous one's outcome.
   *
   * Rotation is throttled to once per grace window (A-2). That keeps
   * `previousTokenHash` stable for its whole window, so any number of tabs that
   * started with the same token all land on `rotated` or `grace` — never on reuse.
   */
  async refresh(
    rawToken: string,
    lifetimes: SessionLifetimes,
    trx: Knex.Transaction,
  ): Promise<RefreshOutcome> {
    const sessionUuid = parseRefreshToken(rawToken);
    if (!sessionUuid) return { kind: "invalid" };

    const row:
      | (IRefreshSession & { withinGrace: boolean; alive: boolean })
      | undefined = await trx(TABLE)
      .select(
        "*",
        trx.raw(
          '"rotatedAt" + make_interval(secs => ?) >= now() AS "withinGrace"',
          [lifetimes.graceSeconds],
        ),
        trx.raw('("expiresAt" > now()) AS "alive"'),
      )
      .where({ uuid: sessionUuid })
      .forUpdate()
      .first();

    if (!row) return { kind: "invalid" };
    const { withinGrace, alive, ...session } = row;
    if (session.revokedAt) return { kind: "revoked", session };
    if (!alive) return { kind: "invalid" };

    const presented = hashToken(rawToken);
    const hasRotated = session.previousTokenHash !== null;

    if (presented === session.tokenHash) {
      if (hasRotated && withinGrace) return { kind: "grace", session };
      const nextRaw = mintToken(session.uuid);
      const [rotated] = await trx(TABLE)
        .where({ id: session.id })
        .update({
          previousTokenHash: session.tokenHash,
          tokenHash: hashToken(nextRaw),
          rotatedAt: trx.fn.now(),
          expiresAt: trx.raw(
            'LEAST(now() + make_interval(secs => ?), "absoluteExpiresAt")',
            [lifetimes.idleSeconds],
          ),
          updatedAt: trx.fn.now(),
        })
        .returning("*");
      return { kind: "rotated", session: rotated, rawToken: nextRaw };
    }

    if (presented === session.previousTokenHash && withinGrace) {
      return { kind: "grace", session };
    }

    const revoked = await this.revoke(session.id, "reuse", trx);
    return { kind: "revoked", session: revoked ?? session };
  }

  async revoke(
    id: number,
    reason: RefreshRevokedReason,
    trx?: Knex.Transaction,
  ): Promise<IRefreshSession | null> {
    const knex = this.knex(trx);
    const [row] = await knex(TABLE)
      .where({ id })
      .whereNull("revokedAt")
      .update({
        revokedAt: knex.fn.now(),
        revokedReason: reason,
        updatedAt: knex.fn.now(),
      })
      .returning("*");
    return row ?? null;
  }

  async revokeByUuid(
    uuid: string,
    reason: RefreshRevokedReason,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const knex = this.knex(trx);
    await knex(TABLE)
      .where({ uuid })
      .whereNull("revokedAt")
      .update({
        revokedAt: knex.fn.now(),
        revokedReason: reason,
        updatedAt: knex.fn.now(),
      });
  }

  /** Every alive session of the user, optionally sparing one (the caller's own on password change). */
  async revokeAllForUser(
    userId: number,
    reason: RefreshRevokedReason,
    trx?: Knex.Transaction,
    exceptUuid?: string,
  ): Promise<number> {
    const knex = this.knex(trx);
    const query = knex(TABLE)
      .where({ userId })
      .whereNull("revokedAt")
      .whereRaw('"expiresAt" > now()');
    if (exceptUuid) query.whereNot({ uuid: exceptUuid });
    return query.update({
      revokedAt: knex.fn.now(),
      revokedReason: reason,
      updatedAt: knex.fn.now(),
    });
  }

  async revokeAllForDevice(
    deviceId: number,
    reason: RefreshRevokedReason,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const knex = this.knex(trx);
    return knex(TABLE)
      .where({ deviceId })
      .whereNull("revokedAt")
      .whereRaw('"expiresAt" > now()')
      .update({
        revokedAt: knex.fn.now(),
        revokedReason: reason,
        updatedAt: knex.fn.now(),
      });
  }

  /** Opportunistic cleanup at sign-in (D-11): the user's expired rows, revoked or not. */
  async deleteExpiredForUser(
    userId: number,
    trx?: Knex.Transaction,
  ): Promise<number> {
    return this.knex(trx)(TABLE)
      .where({ userId })
      .whereRaw('"expiresAt" < now()')
      .delete();
  }
}
