/**
 * The per-request audit state and its `AsyncLocalStorage` (audit P1, handbook
 * §P1.2).
 *
 * **This module is inert on its own.** It owns the state; the ambient facade in
 * `registry.ts` (P1 track T2) and the middleware (T3) are what make `db(key)`
 * behave differently because of it. Until those land, nothing calls anything
 * here and `db()` is byte-identical to what it always was.
 *
 * Why a second `AsyncLocalStorage` rather than a shared request context: the
 * db-per-module split's `src/utils/requestContext.ts` does not exist yet (its
 * track has not landed). When it does, the audit state moves onto it as an
 * `audit?: AuditRequestState` field. Creating that file here instead would
 * guarantee a merge conflict in it, which costs more than a second ALS.
 *
 * Nothing here opens a transaction: T1 is the state plus the helpers that drive
 * a handle someone else opened. The registry (T2) owns the pools, opens one
 * transaction per key on the first awaited query and memoises it into
 * `state.trx`.
 *
 * Three invariants worth stating, because all three are invisible in a green
 * suite:
 *
 * 1. `state.trx` holds the **open promise**, never the resolved handle — which
 *    is why `finishAuditRequest` and `reapplyAuditSetting` await each entry.
 *    Two query builders awaited concurrently both reach T2's `ensureTrx` before
 *    either transaction exists; memoising the handle lets both open one and the
 *    request then writes through two transactions, only one of which commits.
 * 2. `withoutAudit` is the only way out of the store. `armAudit` uses it so its
 *    uuid→id lookups run on plain autocommit connections — see the comment
 *    there; it is not a deadlock guard.
 * 3. `isAmbientAuditActive` is the single expression of "this request writes
 *    through the ambient transaction". `db()` must ask it rather than
 *    re-deriving the four flags, so that dropping one of them is a compile-time
 *    or test-time event and not a silent loss of the audit trail.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Knex } from "knex";
import { DbKey } from "./keys";

/** Where the write came from. Contractual: P2's trigger stores it verbatim. */
export type AuditSource = "api" | "job" | "seed" | "script";

export type AuditActor = {
  /** Numeric `users.id`, resolved once per request. */
  userId: number | null;
  /** `req.user.email`. */
  username: string | null;
  role: string | null;
  /** The token's own company (numeric `companies.id`). */
  actorCompanyId: number | null;
  /**
   * The EFFECTIVE company: for a superAdmin operating as a tenant this is the
   * targeted company, not the token's own (L-009 — `getCompanyScope`).
   */
  companyId: number | null;
};

export type AuditRequestState = {
  requestId: string;
  /** The method is one of POST|PUT|PATCH|DELETE. */
  mutating: boolean;
  /** Set by `armAudit`; before it, `db()` is plain autocommit. */
  armed: boolean;
  /** Set by `detachAuditRequest()`; `db()` stays plain for the whole request. */
  detached: boolean;
  /** Set by `finishAuditRequest()`; after it, `db()` is plain again. */
  finished: boolean;
  source: AuditSource;
  /** `${method} ${baseUrl}${route.path}` — set lazily by `armAudit`. */
  route: string | null;
  ip: string | null;
  ua: string | null;
  actor: AuditActor | null;
  action: string | null;
  /**
   * Memoised OPEN promises, one per database key — the promise, not the
   * transaction: two builders may race into T2's `ensureTrx`. Filled by the
   * registry; only read here.
   */
  trx: Map<DbKey, Promise<Knex.Transaction>>;
};

/**
 * Does `db(key)` hand out the ambient facade? Five conditions, in one place: a
 * request that writes, has been armed, has not opted out and has not ended.
 * `registry.ts` (T2) asks exactly this — it must not re-derive the flags.
 *
 * A type guard, so the caller keeps the narrowed state without a non-null
 * assertion.
 */
export const isAmbientAuditActive = (
  state: AuditRequestState | undefined,
): state is AuditRequestState =>
  state !== undefined &&
  state.mutating &&
  state.armed &&
  !state.detached &&
  !state.finished;

/** A request that writes. Anything else never opens a transaction. */
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

const storage = new AsyncLocalStorage<AuditRequestState>();

export const getAuditState = (): AuditRequestState | undefined =>
  storage.getStore();

/**
 * Run `fn` with NO audit state, so every `db()` inside it is the plain
 * autocommit facade. Used by `armAudit`'s lookups and available to any writer
 * that must stay outside the request's transaction.
 */
export const withoutAudit = <T>(fn: () => T): T => storage.exit(fn);

const emptyState = (): AuditRequestState => ({
  requestId: randomUUID(),
  mutating: false,
  armed: false,
  detached: false,
  finished: false,
  source: "api",
  route: null,
  ip: null,
  ua: null,
  actor: null,
  action: null,
  trx: new Map(),
});

/**
 * Open a request-scoped state and run `fn` inside it. The state is handed to
 * `fn` as well as being reachable through `getAuditState()`, so the middleware
 * does not need a non-null assertion to read the `requestId` it just created.
 */
export function beginAuditRequest(
  req: Request,
  fn: (state: AuditRequestState) => void,
): void {
  const state: AuditRequestState = {
    ...emptyState(),
    mutating: MUTATING_METHODS.includes(req.method),
    ip: req.ip ?? null,
    ua: req.get("user-agent") ?? null,
  };
  storage.run(state, () => fn(state));
}

/**
 * The JSON the trigger reads via `current_setting('mobius.audit')`.
 *
 * **The key set is a contract with P2** (Appendix A) — adding, renaming or
 * dropping one silently changes what every audited row records. `route` appears
 * twice on purpose: once at the top level, once inside `context`.
 */
export function auditSettingJson(state: AuditRequestState): string {
  return JSON.stringify({
    requestId: state.requestId,
    source: state.source,
    route: state.route,
    action: state.action,
    userId: state.actor?.userId ?? null,
    username: state.actor?.username ?? null,
    role: state.actor?.role ?? null,
    companyId: state.actor?.companyId ?? null,
    actorCompanyId: state.actor?.actorCompanyId ?? null,
    context: { ip: state.ip, ua: state.ua, route: state.route },
  });
}

export async function applyAuditSetting(
  trx: Knex.Transaction,
  state: AuditRequestState,
): Promise<void> {
  // `true` = transaction-local (SET LOCAL semantics). Bindings, never string
  // concatenation: the actor's user-agent is attacker-controlled text.
  await trx.raw("select set_config('mobius.audit', ?, true)", [
    auditSettingJson(state),
  ]);
}

/**
 * Re-apply the setting to every transaction already open — the action is
 * usually named after the first write has already opened one.
 */
export async function reapplyAuditSetting(
  state: AuditRequestState,
): Promise<void> {
  for (const pending of state.trx.values()) {
    await applyAuditSetting(await pending, state);
  }
}

/**
 * Name what this request is doing. Defined in P1, called by nobody until P2.
 * Outside a request — a job, a script, a unit test — it is a no-op and never
 * throws.
 */
export async function setAuditAction(action: string): Promise<void> {
  const state = getAuditState();
  if (!state) {
    return;
  }
  state.action = action;
  await reapplyAuditSetting(state);
}

/**
 * Opt this request out of the ambient transaction for good. One-way: a route
 * that holds a pooled connection across network I/O (S3, SES) must not reclaim
 * it later in the same request.
 */
export function detachAuditRequest(): void {
  const state = getAuditState();
  if (state) {
    state.detached = true;
  }
}

export type AuditCommitFailure = { key: DbKey; error: unknown };

/**
 * At least one key failed to commit or roll back. The middleware turns this
 * into a 500 `COMMIT_FAILED` before the bytes leave.
 */
export class AuditCommitError extends Error {
  readonly failures: readonly AuditCommitFailure[];

  constructor(failures: readonly AuditCommitFailure[]) {
    super(
      `Failed to finish the ambient transaction for: ${failures
        .map((failure) => failure.key)
        .join(", ")}`,
    );
    this.name = "AuditCommitError";
    this.failures = failures;
  }
}

/**
 * Commit or roll back everything this request opened. Called exactly once by
 * the middleware's `res.end` wrapper (and on socket close); idempotent, because
 * `close` and `end` both fire on a normal response.
 *
 * Every key is attempted even after one fails — leaving a transaction open
 * holds a pooled connection until `idleTimeoutMillis`, which is how a pool
 * starves (R1).
 */
export async function finishAuditRequest(ok: boolean): Promise<void> {
  const state = getAuditState();
  if (!state || state.finished) {
    return;
  }
  state.finished = true;
  const failures: AuditCommitFailure[] = [];
  for (const [key, pending] of state.trx) {
    try {
      const trx = await pending;
      if (trx.isCompleted()) {
        continue;
      }
      if (ok) {
        await trx.commit();
      } else {
        await trx.rollback();
      }
    } catch (error) {
      failures.push({ key, error });
    }
  }
  if (failures.length > 0) {
    throw new AuditCommitError(failures);
  }
}

/**
 * Arm the request: resolve the actor, name the route, and let `db()` start
 * handing out ambient facades. Called by `authenticate`/`optionalAuth` once
 * `req.user` is set (P1 track T3).
 *
 * A non-mutating request is never armed, so a GET opens no transaction.
 * Unauthenticated mutating routes (login, password reset, invitation accept)
 * reach `next()` without passing through here and therefore stay autocommit for
 * the whole of P1; P2 has those handlers arm themselves.
 */
export async function armAudit(req: Request): Promise<void> {
  const state = getAuditState();
  if (!state || !state.mutating) {
    return;
  }
  // The route as Express knows it. `req.route` is undefined in app-level
  // middleware but set inside a router handler, and `authenticate` runs inside
  // the router, so the specific form is the one that gets recorded.
  state.route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;

  const user = req.user;
  if (user) {
    // Imported lazily: `foreignKeyResolver` imports the registry, which (from
    // T2 on) imports this module. A static import would close that cycle at
    // load time and hand one of the two modules a half-initialised copy of the
    // other.
    const { getIdByUuid } = await import("../utils/foreignKeyResolver");
    const { getCompanyScope } = await import("../utils/companyScope");
    const effectiveCompanyUuid = getCompanyScope(req).companyUuid;
    // These three reads run OUTSIDE the state on purpose. Not as a deadlock
    // guard — `state.armed` is still false here, so `db()` already returns the
    // plain facade. Without it, a later reordering would have every mutating
    // request open a `core` transaction purely to resolve two uuids, spending a
    // pooled connection on a read-only preamble, and the invariant would be
    // implicit in a line order nobody is watching.
    const [userId, actorCompanyId, companyId] = await withoutAudit(() =>
      Promise.all([
        getIdByUuid(user.userId, "users"),
        getIdByUuid(user.companyId ?? null, "companies"),
        getIdByUuid(effectiveCompanyUuid ?? null, "companies"),
      ]),
    );
    state.actor = {
      userId,
      username: user.email,
      role: user.role,
      actorCompanyId,
      companyId,
    };
  }

  state.armed = true;
  // No-op today: nothing is open before arming. Correct if that ever changes.
  await reapplyAuditSetting(state);
}

/**
 * The non-request writer's entry point — jobs, seeds, scripts. Defined in P1,
 * used by P2. Commits on success, rolls back on a throw and rethrows the
 * original error: the caller sees its own failure, not a transaction error.
 */
export async function withAuditContext<T>(
  partial: {
    source: Exclude<AuditSource, "api">;
    username: string;
    companyId?: number | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const state: AuditRequestState = {
    ...emptyState(),
    mutating: true,
    armed: true,
    source: partial.source,
    actor: {
      userId: null,
      username: partial.username,
      role: null,
      actorCompanyId: null,
      companyId: partial.companyId ?? null,
    },
  };
  return storage.run(state, async () => {
    try {
      const out = await fn();
      await finishAuditRequest(true);
      return out;
    } catch (error) {
      await finishAuditRequest(false).catch(() => undefined);
      throw error;
    }
  });
}
