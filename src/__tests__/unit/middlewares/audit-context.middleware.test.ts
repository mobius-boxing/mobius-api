/**
 * The wiring that makes the ambient transaction live (audit P1, track T3 —
 * AC-6, AC-7).
 *
 * No database and no registry: the transaction handles here are the table-aware
 * knex mock with `commit`/`rollback`/`isCompleted` added, placed into the
 * request state exactly where the registry's `ensureTrx` would put them. What is
 * under test is the middleware's decision, driven through T1's REAL
 * `finishAuditRequest` — stubbing that out would leave the commit/rollback
 * choice untested, which is the one thing this file exists to protect.
 *
 * The invariants pinned here, all invisible to a green suite otherwise:
 * - status < 400 commits, anything else rolls back (mutation-checked, L-018);
 * - a GET never opens or finishes anything;
 * - a COMMIT that fails after the handler answered 200 turns the response into
 *   a 500 `COMMIT_FAILED` — never a 200 over rolled-back work;
 * - `detachAudit` puts the request permanently outside the ambient path;
 * - `AUDIT_AMBIENT_TX=off` is a pure pass-through.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import type { Knex } from "knex";
import {
  auditContext,
  detachAudit,
} from "../../../middlewares/audit-context.middleware";
import {
  getAuditState,
  isAmbientAuditActive,
  type AuditRequestState,
} from "../../../database/audit-context";
import {
  createMockRequest,
  createMockResponse,
} from "../../mocks/express.mock";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Let the middleware's `finish(...).then(...)` chain run to completion. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

type FakeTrx = {
  commit: jest.Mock<() => Promise<void>>;
  rollback: jest.Mock<() => Promise<void>>;
  isCompleted: () => boolean;
};

/**
 * A transaction handle shaped like the one `ensureTrx` memoises: the table-aware
 * knex mock (so a write can actually be issued through it) plus the three
 * members `finishAuditRequest` drives.
 */
const createFakeTrx = (
  overrides: Partial<{ commit: () => Promise<void> }> = {},
) => {
  const mock = createTableAwareKnexMock();
  const trx = mock.knexMock as unknown as FakeTrx & {
    (table: string): { insert: (row: unknown) => unknown };
  };
  trx.commit = jest.fn(overrides.commit ?? (async () => undefined));
  trx.rollback = jest.fn(async () => undefined);
  trx.isCompleted = () => false;
  return { trx, writeLog: mock.writeLog };
};

type TestResponse = Response & {
  headers: Record<string, unknown>;
  endArgs: unknown[][];
  emit: (event: string) => void;
};

/**
 * The half-dozen `res` members the middleware actually touches. Built as its own
 * mutable shape because `Response["writableEnded"]` is readonly — a test double
 * has to be able to flip it.
 */
type MutableRes = {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  headers: Record<string, unknown>;
  endArgs: unknown[][];
  setHeader: (name: string, value: unknown) => MutableRes;
  getHeader: (name: string) => unknown;
  removeHeader: (name: string) => void;
  on: (event: string, listener: () => void) => MutableRes;
  end: (...args: unknown[]) => MutableRes;
  emit: (event: string) => void;
};

const createRes = (statusCode = 200): TestResponse => {
  const headers: Record<string, unknown> = {};
  const listeners: Record<string, Array<() => void>> = {};
  const endArgs: unknown[][] = [];
  const res: MutableRes = {
    ...(createMockResponse() as unknown as MutableRes),
    statusCode,
    headersSent: false,
    writableEnded: false,
    headers,
    endArgs,
    setHeader: jest.fn((name: string, value: unknown) => {
      headers[name] = value;
      return res;
    }),
    getHeader: (name: string): unknown => headers[name],
    removeHeader: jest.fn((name: string) => {
      delete headers[name];
    }),
    on: jest.fn((event: string, listener: () => void) => {
      (listeners[event] ??= []).push(listener);
      return res;
    }),
    end: jest.fn((...args: unknown[]) => {
      endArgs.push(args);
      res.writableEnded = true;
      return res;
    }),
    emit: (event: string): void => {
      (listeners[event] ?? []).forEach((listener) => listener());
    },
  };
  return res as unknown as TestResponse;
};

const createReq = (method: string): Request =>
  createMockRequest({ method, path: "/warehouses" }) as Request;

/**
 * Run the middleware and capture the state the handler sees. `handler` stands in
 * for everything downstream of `app.use(auditContext)`.
 */
const run = (
  method: string,
  res: TestResponse,
  handler: (state: AuditRequestState | undefined) => void = () => undefined,
): { state: AuditRequestState | undefined } => {
  const captured: { state: AuditRequestState | undefined } = {
    state: undefined,
  };
  const next: NextFunction = () => {
    captured.state = getAuditState();
    handler(captured.state);
  };
  auditContext(createReq(method), res, next);
  return captured;
};

/** Put a transaction into the request state where `ensureTrx` would put it. */
const attachTrx = (
  state: AuditRequestState | undefined,
  trx: FakeTrx,
): void => {
  state?.trx.set("core", Promise.resolve(trx as unknown as Knex.Transaction));
};

describe("auditContext middleware (audit P1 T3, AC-6/AC-7)", () => {
  beforeEach(() => {
    delete process.env.AUDIT_AMBIENT_TX;
  });

  describe("AC-7 — X-Request-Id", () => {
    it("puts a uuid on every response, GET and POST alike", () => {
      const get = createRes();
      run("GET", get);
      const post = createRes(201);
      run("POST", post);

      expect(String(get.headers["X-Request-Id"])).toMatch(UUID_RE);
      expect(String(post.headers["X-Request-Id"])).toMatch(UUID_RE);
    });

    it("mints a different id per request", () => {
      const first = createRes();
      const second = createRes();
      run("GET", first);
      run("GET", second);

      expect(first.headers["X-Request-Id"]).not.toBe(
        second.headers["X-Request-Id"],
      );
    });

    it("echoes the id the state carries, so the log and the header agree", () => {
      const res = createRes();
      const { state } = run("GET", res);

      expect(res.headers["X-Request-Id"]).toBe(state?.requestId);
    });
  });

  describe("mutating vs non-mutating", () => {
    it("marks POST/PUT/PATCH/DELETE mutating and GET/HEAD/OPTIONS not", () => {
      const seen = [
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "GET",
        "HEAD",
        "OPTIONS",
      ].map((method) => run(method, createRes()).state?.mutating);

      expect(seen).toStrictEqual([true, true, true, true, false, false, false]);
    });

    it("leaves res.end untouched on a GET — nothing to commit, nothing to wrap", async () => {
      const res = createRes();
      const original = res.end;
      const { trx } = createFakeTrx();
      const { state } = run("GET", res, (s) => attachTrx(s, trx));

      expect(res.end).toBe(original);
      res.end("body");
      await flush();

      expect(res.endArgs).toStrictEqual([["body"]]);
      expect(trx.commit).not.toHaveBeenCalled();
      expect(trx.rollback).not.toHaveBeenCalled();
      expect(state?.finished).toBe(false);
    });
  });

  describe("AC-6 — the commit/rollback decision", () => {
    it("commits on 201 and then ends with the original arguments", async () => {
      const res = createRes(201);
      const { trx } = createFakeTrx();
      const { state } = run("POST", res, (s) => attachTrx(s, trx));

      res.end("created", "utf8");
      await flush();

      expect(trx.commit).toHaveBeenCalledTimes(1);
      expect(trx.rollback).not.toHaveBeenCalled();
      expect(res.endArgs).toStrictEqual([["created", "utf8"]]);
      expect(state?.finished).toBe(true);
    });

    it("commits on a 3xx redirect (the boundary is 400, not 300)", async () => {
      const res = createRes(302);
      const { trx } = createFakeTrx();
      run("POST", res, (s) => attachTrx(s, trx));

      res.end();
      await flush();

      expect(trx.commit).toHaveBeenCalledTimes(1);
      expect(trx.rollback).not.toHaveBeenCalled();
    });

    it("rolls back on 409, discarding the write the handler had issued", async () => {
      const res = createRes();
      const { trx, writeLog } = createFakeTrx();
      run("PUT", res, (s) => {
        attachTrx(s, trx);
        void (
          trx as unknown as (t: string) => { insert: (r: unknown) => void }
        )("warehouses").insert({ code: "W1" });
        res.statusCode = 409;
      });

      res.end("conflict");
      await flush();

      expect(writeLog).toStrictEqual([
        { table: "warehouses", op: "insert", data: { code: "W1" } },
      ]);
      expect(trx.rollback).toHaveBeenCalledTimes(1);
      expect(trx.commit).not.toHaveBeenCalled();
      expect(res.endArgs).toStrictEqual([["conflict"]]);
    });

    it("rolls back on a 500 raised after a partial write", async () => {
      const res = createRes(500);
      const { trx } = createFakeTrx();
      run("DELETE", res, (s) => attachTrx(s, trx));

      res.end();
      await flush();

      expect(trx.rollback).toHaveBeenCalledTimes(1);
      expect(trx.commit).not.toHaveBeenCalled();
    });

    it("rolls back when the client vanishes before the response ends", async () => {
      const res = createRes(200);
      const { trx } = createFakeTrx();
      run("POST", res, (s) => attachTrx(s, trx));

      res.emit("close");
      await flush();

      expect(trx.rollback).toHaveBeenCalledTimes(1);
      expect(trx.commit).not.toHaveBeenCalled();
    });

    it("is a no-op on the close that follows a normal end", async () => {
      const res = createRes(200);
      const { trx } = createFakeTrx();
      run("POST", res, (s) => attachTrx(s, trx));

      res.end("ok");
      await flush();
      res.emit("close");
      await flush();

      expect(trx.commit).toHaveBeenCalledTimes(1);
      expect(trx.rollback).not.toHaveBeenCalled();
    });

    it("guards re-entrancy: a second end does not finish the request twice", async () => {
      const res = createRes(200);
      const { trx } = createFakeTrx();
      run("POST", res, (s) => attachTrx(s, trx));

      res.end("first");
      res.end("second");
      await flush();

      expect(trx.commit).toHaveBeenCalledTimes(1);
      expect(res.endArgs).toStrictEqual([["second"], ["first"]]);
    });
  });

  describe("AC-6 — a commit that fails after the handler answered 200", () => {
    it("rewrites the response to a 500 COMMIT_FAILED and drops Content-Length", async () => {
      const res = createRes(200);
      res.headers["Content-Length"] = "17";
      const { trx } = createFakeTrx({
        commit: async () => {
          throw new Error("connection lost");
        },
      });
      const errors = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      run("POST", res, (s) => attachTrx(s, trx));

      res.end(JSON.stringify({ success: true }));
      await flush();

      expect(res.statusCode).toBe(500);
      expect(res.headers["Content-Length"]).toBeUndefined();
      expect(res.headers["Content-Type"]).toBe("application/json");
      expect(res.endArgs).toStrictEqual([
        [
          JSON.stringify({
            success: false,
            message: "Internal server error",
            code: "COMMIT_FAILED",
          }),
        ],
      ]);
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
    });

    it("cannot rewrite a response whose headers already went out, and says so in the log", async () => {
      const res = createRes(200);
      const { trx } = createFakeTrx({
        commit: async () => {
          throw new Error("connection lost");
        },
      });
      const errors = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      run("POST", res, (s) => attachTrx(s, trx));
      // A handler that streamed: the status line is already on the wire.
      (res as unknown as { headersSent: boolean }).headersSent = true;

      res.end("tail");
      await flush();

      expect(res.statusCode).toBe(200);
      expect(res.endArgs).toStrictEqual([["tail"]]);
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
    });
  });

  describe("detachAudit", () => {
    it("takes the request out of the ambient path for good", () => {
      const res = createRes(201);
      const { state } = run("POST", res, () => {
        detachAudit(createReq("POST"), res, () => undefined);
      });

      expect(state?.detached).toBe(true);
      expect(isAmbientAuditActive(state)).toBe(false);
    });

    it("still commits nothing, because nothing was ever opened", async () => {
      const res = createRes(201);
      const { trx } = createFakeTrx();
      run("POST", res, () => {
        detachAudit(createReq("POST"), res, () => undefined);
      });

      res.end("ok");
      await flush();

      expect(trx.commit).not.toHaveBeenCalled();
      expect(trx.rollback).not.toHaveBeenCalled();
      expect(res.endArgs).toStrictEqual([["ok"]]);
    });

    it("calls next exactly once", () => {
      const next = jest.fn();
      detachAudit(createReq("POST"), createRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("kill switch AUDIT_AMBIENT_TX", () => {
    it.each(["0", "false", "off", "no", "OFF", " false "])(
      "is a pure pass-through when set to %p",
      (value) => {
        process.env.AUDIT_AMBIENT_TX = value;
        const res = createRes(201);
        const original = res.end;
        const { state } = run("POST", res);

        expect(state).toBeUndefined();
        expect(res.headers["X-Request-Id"]).toBeUndefined();
        expect(res.end).toBe(original);
      },
    );

    it("is on when unset, and on for any other value", () => {
      const unset = createRes(201);
      expect(run("POST", unset).state).toBeDefined();

      process.env.AUDIT_AMBIENT_TX = "on";
      const explicit = createRes(201);
      expect(run("POST", explicit).state).toBeDefined();
    });

    it("commits nothing while it is off, even with a transaction in the state", async () => {
      process.env.AUDIT_AMBIENT_TX = "false";
      const res = createRes(201);
      const { trx } = createFakeTrx();
      run("POST", res, (s) => attachTrx(s, trx));

      res.end("ok");
      await flush();

      expect(trx.commit).not.toHaveBeenCalled();
      expect(trx.rollback).not.toHaveBeenCalled();
      expect(res.endArgs).toStrictEqual([["ok"]]);
    });
  });
});
