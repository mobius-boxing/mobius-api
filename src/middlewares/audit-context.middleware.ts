/**
 * The switch that makes the ambient request transaction live (audit P1, track
 * T3 — handbook §P1.4).
 *
 * `audit-context.ts` (T1) owns the state and `registry.ts` (T2) owns the facade,
 * but both are inert until something opens a request state: without this
 * middleware `getAuditState()` is always `undefined` and `db(key)` is
 * byte-identical to what it always was. Mounting `auditContext` is what turns
 * every `POST|PUT|PATCH|DELETE` into one transaction per database key it
 * touches, committed when the handler answered < 400 and rolled back otherwise.
 *
 * **Kill switch: `AUDIT_AMBIENT_TX`.** Default **on**. Set it to `0`, `false`,
 * `off` or `no` (case-insensitive) and `auditContext` becomes a pure
 * pass-through: no request state, no transaction, no `X-Request-Id` — exactly
 * the behaviour of the deploy before P1, without a rollback deploy. The variable
 * is read per request, so a process restart is all it takes to flip it. Note
 * that the header goes away with it; it is a P1 addition and no client reads it
 * (§3 of the brief).
 *
 * **Where the commit happens, and why there.** `res.end` is wrapped, not
 * `res.json`: the transaction must be resolved BEFORE the bytes leave, and
 * `res.end` is the last point where the status line can still be changed. If
 * the handler answered 200 and the COMMIT then fails, the response is rewritten
 * to a 500 `COMMIT_FAILED` — answering 200 for work that was rolled back is the
 * one outcome this design may never produce. `sanitizeResponse` wraps `res.json`
 * and therefore never interacts with this wrapper.
 *
 * **The one case where the rewrite cannot happen**: a handler that streams
 * (`res.write`) before ending has already flushed its status line, so a commit
 * failure can only be logged. No mutating route streams today — the only
 * streaming responses are GET downloads, which never open a transaction.
 *
 * **Why `AsyncResource.bind`.** `finishAuditRequest` reads the state from the
 * `AsyncLocalStorage`, and the `close` event is emitted from the socket's async
 * context, not the handler's — an unbound listener would find an empty store,
 * finish nothing and leak the pooled connection until `idleTimeoutMillis` (R1,
 * the pool-exhaustion risk). Binding captures this request's store for both the
 * `end` and the `close` path, whoever ends up calling them.
 */
import { AsyncResource } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import {
  beginAuditRequest,
  detachAuditRequest,
  finishAuditRequest,
} from "../database/audit-context";

/** Values of `AUDIT_AMBIENT_TX` that disable the ambient transaction. */
const DISABLED = new Set(["0", "false", "off", "no"]);

/**
 * Read per request rather than at import time: a unit test (and an operator
 * reading a restarted process's environment) must be able to flip it without
 * the module being re-evaluated.
 */
const ambientAuditEnabled = (): boolean =>
  !DISABLED.has((process.env.AUDIT_AMBIENT_TX ?? "").trim().toLowerCase());

const COMMIT_FAILED_BODY = JSON.stringify({
  success: false,
  message: "Internal server error",
  code: "COMMIT_FAILED",
});

/**
 * Open the request's audit state and, for a mutating request, commit or roll
 * back everything it opened before the response is written.
 *
 * Mounted globally in `app.ts` after `sanitizeResponse` and before
 * `app.use("/api", …)`. A GET/HEAD/OPTIONS gets the state (so it carries an
 * `X-Request-Id`) but is never `mutating`, so it never opens a transaction.
 */
export const auditContext = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!ambientAuditEnabled()) {
    next();
    return;
  }

  beginAuditRequest(req, (state) => {
    res.setHeader("X-Request-Id", state.requestId);
    if (!state.mutating) {
      next();
      return;
    }

    const originalEnd = res.end.bind(res) as (...args: unknown[]) => Response;
    // Bound to THIS request's store — see the header comment.
    const finish = AsyncResource.bind(finishAuditRequest);
    let ending = false;

    res.end = ((...args: unknown[]): Response => {
      if (ending) return originalEnd(...args);
      ending = true;
      // The handler's own answer decides: < 400 commits, anything else rolls
      // back. Reading `res.statusCode` here rather than earlier is what makes a
      // 4xx raised late (a validation failure after a partial write) roll the
      // partial write back.
      const ok = res.statusCode < 400;
      void finish(ok).then(
        () => originalEnd(...args),
        (error: unknown) => {
          console.error(`[audit] commit failed for ${state.requestId}:`, error);
          if (res.headersSent) {
            // Status line already on the wire; the log is all that is left.
            originalEnd(...args);
            return;
          }
          res.statusCode = 500;
          res.removeHeader("Content-Length");
          res.setHeader("Content-Type", "application/json");
          originalEnd(COMMIT_FAILED_BODY);
        },
      );
      return res;
    }) as typeof res.end;

    // The client went away before we answered: nothing may stay open.
    // `finishAuditRequest` is idempotent, so the normal path's `close` (which
    // fires after `end`) is a no-op.
    res.on(
      "close",
      AsyncResource.bind(() => {
        if (res.writableEnded) return;
        void finishAuditRequest(false).catch((error: unknown) => {
          console.error(
            `[audit] rollback after close failed for ${state.requestId}:`,
            error,
          );
        });
      }),
    );

    next();
  });
};

/**
 * Per-route opt-out: this request stays on plain autocommit connections for the
 * whole of its life, `X-Request-Id` included.
 *
 * Mount it (after `authenticate`) on any mutating route that does network I/O
 * to something that is not Postgres — S3, an LLM, anything with a round trip
 * measured in seconds. Holding a pooled connection across such a call is how a
 * pool of 12 starves (risk R1). Today: the two file uploads and the S3 copy.
 */
export const detachAudit = (
  _req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  detachAuditRequest();
  next();
};
