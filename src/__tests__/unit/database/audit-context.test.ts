/**
 * The per-request audit state (audit P1, track T1 — AC-1, AC-2, AC-8).
 *
 * No database is touched: the transactions here are hand-built doubles that
 * count `raw`/`commit`/`rollback`, which is exactly what the module drives. The
 * things worth protecting are invisible to a green suite unless they are named:
 *
 * - the store is per request (two concurrent requests, interleaved for real —
 *   two sequential calls would pass with a module-level variable);
 * - `state.trx` holds the OPEN PROMISE, not the handle, so two builders that
 *   race share one transaction and a request that ends mid-open still finishes
 *   it (the registry fills the map in T2 — here `openTrx` models it);
 * - `armAudit`'s uuid→id lookups run with an EMPTY store, so a mutating request
 *   does not spend a pooled `core` connection on a read-only preamble;
 * - `isAmbientAuditActive` is the whole of what `db()` will ask, so every flag
 *   that switches the ambient path off is pinned here;
 * - `auditSettingJson`'s key set is a contract with P2's trigger.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request } from "express";
import type { Knex } from "knex";

/**
 * Captured lookups. `state` is what `getAuditState()` answered at call time and
 * must be `undefined` for every one of them (AC-2).
 */
const mockLookupCalls: Array<{
  uuid: string | null | undefined;
  table: string;
  state: unknown;
}> = [];

/** `"<table>:<uuid>"` → numeric id. Anything unlisted resolves to null. */
const mockIds: Record<string, number> = {};

const mockCurrentState = (): unknown => getAuditState();

// `companyScope` is deliberately NOT mocked: the superAdmin operating-as case
// is the reason the effective company exists (L-009), and a stub would assert
// nothing about it. `foreignKeyResolver` is mocked because it imports the
// registry, which owns real pools.
jest.mock("../../../utils/foreignKeyResolver", () => ({
  __esModule: true,
  getIdByUuid: async (
    uuid: string | null | undefined,
    table: string,
  ): Promise<number | null> => {
    mockLookupCalls.push({ uuid, table, state: mockCurrentState() });
    return mockIds[`${table}:${uuid}`] ?? null;
  },
}));

import {
  applyAuditSetting,
  armAudit,
  auditSettingJson,
  AuditCommitError,
  beginAuditRequest,
  detachAuditRequest,
  finishAuditRequest,
  getAuditState,
  isAmbientAuditActive,
  setAuditAction,
  withAuditContext,
  withoutAudit,
  type AuditRequestState,
} from "../../../database/audit-context";
import { DbKey } from "../../../database/keys";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const ACTOR_COMPANY_UUID = "22222222-2222-4222-8222-222222222222";
const TARGET_COMPANY_UUID = "33333333-3333-4333-8333-333333333333";

type FakeRequestInit = {
  method?: string;
  ip?: string;
  userAgent?: string;
  baseUrl?: string;
  path?: string;
  /** `undefined` ⇒ no `req.route`, as in app-level middleware. */
  routePath?: string;
  user?: Request["user"];
  query?: Record<string, string>;
  body?: Record<string, string>;
};

/**
 * The handful of `Request` members the module reads. One cast, through
 * `unknown`, in one place — never `any`, and never on `req.user`.
 */
const fakeRequest = (init: FakeRequestInit = {}): Request =>
  ({
    method: init.method ?? "GET",
    ip: init.ip,
    baseUrl: init.baseUrl ?? "",
    path: init.path ?? "/",
    route: init.routePath === undefined ? undefined : { path: init.routePath },
    user: init.user,
    query: init.query ?? {},
    body: init.body ?? {},
    get: (name: string): string | undefined =>
      name.toLowerCase() === "user-agent" ? init.userAgent : undefined,
  }) as unknown as Request;

/** A promise plus its resolver, so two contexts can be interleaved on purpose. */
const createGate = (): { opened: Promise<void>; release: () => void } => {
  let resolver: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { opened, release: (): void => resolver() };
};

/** `beginAuditRequest`, but awaitable — the module's own callback is sync. */
const runInContext = <T>(
  req: Request,
  fn: (state: AuditRequestState) => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    beginAuditRequest(req, (state) => {
      fn(state).then(resolve, reject);
    });
  });

const captureState = (req: Request): AuditRequestState => {
  let captured: AuditRequestState | undefined;
  beginAuditRequest(req, (state) => {
    captured = state;
  });
  if (!captured) {
    throw new Error("beginAuditRequest never handed out a state");
  }
  return captured;
};

type TrxRecord = {
  raws: Array<{ sql: string; bindings: unknown[] }>;
  commits: number;
  rollbacks: number;
  completed: boolean;
};

/** A transaction handle shaped like the four members the module calls. */
const createFakeTrx = (
  behaviour: { failOn?: "commit" | "rollback"; completed?: boolean } = {},
): { trx: Knex.Transaction; record: TrxRecord } => {
  const record: TrxRecord = {
    raws: [],
    commits: 0,
    rollbacks: 0,
    completed: behaviour.completed ?? false,
  };
  const trx = {
    raw: (sql: string, bindings: unknown[]): Promise<{ rows: unknown[] }> => {
      record.raws.push({ sql, bindings });
      return Promise.resolve({ rows: [] });
    },
    isCompleted: (): boolean => record.completed,
    commit: (): Promise<void> => {
      record.commits += 1;
      record.completed = true;
      return behaviour.failOn === "commit"
        ? Promise.reject(new Error("commit failed"))
        : Promise.resolve();
    },
    rollback: (): Promise<void> => {
      record.rollbacks += 1;
      record.completed = true;
      return behaviour.failOn === "rollback"
        ? Promise.reject(new Error("rollback failed"))
        : Promise.resolve();
    },
  };
  return { trx: trx as unknown as Knex.Transaction, record };
};

const settingsWritten = (record: TrxRecord): unknown[] =>
  record.raws.map((call) => JSON.parse(String(call.bindings[0])));

/**
 * What the registry's `ensureTrx` does in T2, minus the pool: memoise the OPEN
 * PROMISE for `key` — before it resolves — and label the transaction. A fixture
 * on purpose: T1 only ever reads `state.trx`; opening is T2's job (AC-4). The
 * cases below assert what the map's contents must survive, not this helper.
 */
const openTrx = (
  state: AuditRequestState,
  key: DbKey,
  open: () => Promise<Knex.Transaction>,
): Promise<Knex.Transaction> => {
  const memoised = state.trx.get(key);
  if (memoised) {
    return memoised;
  }
  const pending = (async (): Promise<Knex.Transaction> => {
    const trx = await open();
    await applyAuditSetting(trx, state);
    return trx;
  })();
  state.trx.set(key, pending);
  return pending;
};

beforeEach(() => {
  mockLookupCalls.length = 0;
  for (const key of Object.keys(mockIds)) {
    delete mockIds[key];
  }
});

describe("AC-1 — auditSettingJson is the P2 trigger contract", () => {
  const populated = (): AuditRequestState => {
    const state = captureState(
      fakeRequest({
        method: "PUT",
        ip: "10.0.0.7",
        userAgent: "jest/1.0",
      }),
    );
    state.route = "PUT /api/customers/:uuid";
    state.action = "customer.update";
    state.actor = {
      userId: 42,
      username: "admin@example.com",
      role: "admin",
      actorCompanyId: 7,
      companyId: 9,
    };
    return state;
  };

  it("emits exactly the contracted keys, in the contracted shape", () => {
    const state = populated();

    expect(JSON.parse(auditSettingJson(state))).toStrictEqual({
      requestId: state.requestId,
      source: "api",
      route: "PUT /api/customers/:uuid",
      action: "customer.update",
      userId: 42,
      username: "admin@example.com",
      role: "admin",
      companyId: 9,
      actorCompanyId: 7,
      context: {
        ip: "10.0.0.7",
        ua: "jest/1.0",
        route: "PUT /api/customers/:uuid",
      },
    });
  });

  it("emits the key set itself — nothing added, nothing renamed", () => {
    const parsed: unknown = JSON.parse(auditSettingJson(populated()));

    expect(Object.keys(parsed as object)).toEqual([
      "requestId",
      "source",
      "route",
      "action",
      "userId",
      "username",
      "role",
      "companyId",
      "actorCompanyId",
      "context",
    ]);
    expect(Object.keys((parsed as { context: object }).context)).toEqual([
      "ip",
      "ua",
      "route",
    ]);
  });

  it("keeps every key with a null when there is no actor, no route, no action", () => {
    const state = captureState(fakeRequest({ method: "POST" }));

    expect(JSON.parse(auditSettingJson(state))).toStrictEqual({
      requestId: state.requestId,
      source: "api",
      route: null,
      action: null,
      userId: null,
      username: null,
      role: null,
      companyId: null,
      actorCompanyId: null,
      context: { ip: null, ua: null, route: null },
    });
  });

  it("distinguishes the effective company from the actor's own", () => {
    const state = populated();
    const parsed = JSON.parse(auditSettingJson(state)) as {
      companyId: number;
      actorCompanyId: number;
    };

    // A superAdmin operating as company 9 writes rows that belong to 9 and were
    // made by an actor from 7. Collapsing the two loses the operating-as trail.
    expect(parsed.companyId).toBe(9);
    expect(parsed.actorCompanyId).toBe(7);
  });
});

describe("beginAuditRequest", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "marks %s as mutating",
    (method) => {
      expect(captureState(fakeRequest({ method })).mutating).toBe(true);
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])("marks %s as not mutating", (method) => {
    expect(captureState(fakeRequest({ method })).mutating).toBe(false);
  });

  it("starts unarmed, undetached, unfinished, with nothing open", () => {
    const state = captureState(fakeRequest({ method: "POST" }));

    expect(state.armed).toBe(false);
    expect(state.detached).toBe(false);
    expect(state.finished).toBe(false);
    expect(state.route).toBeNull();
    expect(state.actor).toBeNull();
    expect(state.action).toBeNull();
    expect(state.trx.size).toBe(0);
    expect(state.source).toBe("api");
  });

  it("records a fresh uuid, the ip and the user-agent", () => {
    const first = captureState(
      fakeRequest({ method: "POST", ip: "10.0.0.7", userAgent: "jest/1.0" }),
    );
    const second = captureState(fakeRequest({ method: "POST" }));

    expect(first.requestId).toMatch(UUID_PATTERN);
    expect(second.requestId).toMatch(UUID_PATTERN);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.ip).toBe("10.0.0.7");
    expect(first.ua).toBe("jest/1.0");
    expect(second.ip).toBeNull();
    expect(second.ua).toBeNull();
  });

  it("keeps two concurrent requests apart across a real suspension", async () => {
    const gate = createGate();
    const seenByA: Array<string | undefined> = [];

    const a = runInContext(fakeRequest({ method: "POST" }), async (state) => {
      seenByA.push(getAuditState()?.requestId);
      await gate.opened;
      // B ran, and started its own context, while this one was suspended.
      seenByA.push(getAuditState()?.requestId);
      return state.requestId;
    });
    const b = runInContext(fakeRequest({ method: "POST" }), async (state) => {
      gate.release();
      await Promise.resolve();
      expect(getAuditState()?.requestId).toBe(state.requestId);
      return state.requestId;
    });

    const [idA, idB] = await Promise.all([a, b]);

    expect(idA).not.toBe(idB);
    expect(seenByA).toEqual([idA, idA]);
  });

  it("leaves no state behind once the request is over", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async () => {
      expect(getAuditState()).toBeDefined();
    });

    expect(getAuditState()).toBeUndefined();
  });
});

describe("withoutAudit", () => {
  it("empties the store for the duration and restores it afterwards", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const inside = withoutAudit(() => getAuditState());

      expect(inside).toBeUndefined();
      expect(getAuditState()).toBe(state);
    });
  });

  it("keeps the store empty inside an async continuation it starts", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async () => {
      const seen = await withoutAudit(async () => {
        await Promise.resolve();
        return getAuditState();
      });

      expect(seen).toBeUndefined();
    });
  });

  it("returns the callback's value and is harmless outside a request", () => {
    expect(withoutAudit(() => "plain")).toBe("plain");
    expect(withoutAudit(() => getAuditState())).toBeUndefined();
  });
});

describe("AC-2 — armAudit", () => {
  const superAdmin: Request["user"] = {
    userId: USER_UUID,
    email: "root@example.com",
    role: "superAdmin",
    companyId: ACTOR_COMPANY_UUID,
  };

  it("does not arm a GET, and looks nothing up", async () => {
    await runInContext(fakeRequest({ method: "GET" }), async (state) => {
      await armAudit(fakeRequest({ method: "GET", user: superAdmin }));

      expect(state.armed).toBe(false);
      expect(state.route).toBeNull();
      expect(mockLookupCalls).toEqual([]);
    });
  });

  it("arms an unauthenticated mutating request with no actor", async () => {
    const req = fakeRequest({
      method: "POST",
      baseUrl: "/api/auth",
      routePath: "/login",
    });

    await runInContext(req, async (state) => {
      await armAudit(req);

      expect(state.armed).toBe(true);
      expect(state.actor).toBeNull();
      expect(state.route).toBe("POST /api/auth/login");
      expect(mockLookupCalls).toEqual([]);
    });
  });

  it("resolves the actor's uuids to numbers, effective company included", async () => {
    mockIds[`users:${USER_UUID}`] = 42;
    mockIds[`companies:${ACTOR_COMPANY_UUID}`] = 7;
    mockIds[`companies:${TARGET_COMPANY_UUID}`] = 9;
    const req = fakeRequest({
      method: "PUT",
      baseUrl: "/api/customers",
      routePath: "/:uuid",
      user: superAdmin,
      // A superAdmin operating as another tenant: the effective company comes
      // from the request, the actor's own from the token (L-009).
      query: { companyId: TARGET_COMPANY_UUID },
    });

    await runInContext(req, async (state) => {
      await armAudit(req);

      expect(state.actor).toStrictEqual({
        userId: 42,
        username: "root@example.com",
        role: "superAdmin",
        actorCompanyId: 7,
        companyId: 9,
      });
      expect(state.route).toBe("PUT /api/customers/:uuid");
      expect(state.armed).toBe(true);
    });
  });

  it("asks for exactly three ids, on the tables that own them", async () => {
    const req = fakeRequest({
      method: "POST",
      user: superAdmin,
      query: { companyId: TARGET_COMPANY_UUID },
    });

    await runInContext(req, async () => {
      await armAudit(req);
    });

    expect(mockLookupCalls.map(({ uuid, table }) => ({ uuid, table }))).toEqual(
      [
        { uuid: USER_UUID, table: "users" },
        { uuid: ACTOR_COMPANY_UUID, table: "companies" },
        { uuid: TARGET_COMPANY_UUID, table: "companies" },
      ],
    );
  });

  it("runs every lookup with an EMPTY store, so none of them opens a transaction", async () => {
    const req = fakeRequest({
      method: "POST",
      user: superAdmin,
      query: { companyId: TARGET_COMPANY_UUID },
    });

    await runInContext(req, async () => {
      await armAudit(req);
    });

    expect(mockLookupCalls).toHaveLength(3);
    expect(mockLookupCalls.map((call) => call.state)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("scopes a non-superAdmin to its own company on both sides", async () => {
    mockIds[`users:${USER_UUID}`] = 42;
    mockIds[`companies:${ACTOR_COMPANY_UUID}`] = 7;
    const req = fakeRequest({
      method: "POST",
      user: {
        userId: USER_UUID,
        email: "member@example.com",
        role: "member",
        companyId: ACTOR_COMPANY_UUID,
      },
      // Ignored: a member may not target another tenant.
      query: { companyId: TARGET_COMPANY_UUID },
    });

    await runInContext(req, async (state) => {
      await armAudit(req);

      expect(state.actor?.actorCompanyId).toBe(7);
      expect(state.actor?.companyId).toBe(7);
    });
  });

  it("keeps unresolvable uuids as null rather than inventing an actor", async () => {
    const req = fakeRequest({ method: "POST", user: superAdmin });

    await runInContext(req, async (state) => {
      await armAudit(req);

      expect(state.actor).toStrictEqual({
        userId: null,
        username: "root@example.com",
        role: "superAdmin",
        actorCompanyId: null,
        companyId: null,
      });
    });
  });

  it("falls back to req.path when the route is not known yet", async () => {
    const req = fakeRequest({ method: "DELETE", path: "/api/warehouses/abc" });

    await runInContext(req, async (state) => {
      await armAudit(req);

      expect(state.route).toBe("DELETE /api/warehouses/abc");
    });
  });

  it("is a no-op outside a request", async () => {
    await expect(
      armAudit(fakeRequest({ method: "POST", user: superAdmin })),
    ).resolves.toBeUndefined();
    expect(mockLookupCalls).toEqual([]);
  });
});

describe("state.trx — the promise contract the registry must honour", () => {
  it("hands two racing callers one promise, so one transaction is opened", async () => {
    const state = captureState(fakeRequest({ method: "POST" }));
    const { trx, record } = createFakeTrx();
    const gate = createGate();
    let opens = 0;
    const open = async (): Promise<Knex.Transaction> => {
      opens += 1;
      await gate.opened;
      return trx;
    };

    // Both callers arrive before either transaction exists — the case that
    // memoising the resolved handle gets wrong.
    const first = openTrx(state, "erp", open);
    const second = openTrx(state, "erp", open);
    gate.release();
    const [a, b] = await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(opens).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe(trx);
    expect(state.trx.size).toBe(1);
    expect(record.raws).toHaveLength(1);
  });

  it("labels the transaction once, transaction-locally, with bindings", async () => {
    const state = captureState(
      fakeRequest({ method: "POST", ip: "10.0.0.7", userAgent: "jest/1.0" }),
    );
    const { trx, record } = createFakeTrx();

    await openTrx(state, "core", () => Promise.resolve(trx));
    await openTrx(state, "core", () => Promise.resolve(trx));

    expect(record.raws).toHaveLength(1);
    expect(record.raws[0]?.sql).toBe(
      "select set_config('mobius.audit', ?, true)",
    );
    expect(record.raws[0]?.bindings).toEqual([auditSettingJson(state)]);
  });

  it("keeps one entry per database key", async () => {
    const state = captureState(fakeRequest({ method: "POST" }));
    const core = createFakeTrx();
    const erp = createFakeTrx();

    const [a, b] = await Promise.all([
      openTrx(state, "core", () => Promise.resolve(core.trx)),
      openTrx(state, "erp", () => Promise.resolve(erp.trx)),
    ]);

    expect(a).toBe(core.trx);
    expect(b).toBe(erp.trx);
    expect([...state.trx.keys()]).toEqual(["core", "erp"]);
  });

  it("finishes a transaction whose open promise has not resolved yet", async () => {
    // The map holds promises, not handles: `finishAuditRequest` awaits each
    // entry. A response that ends while a transaction is still opening would
    // otherwise leave it open, holding a pooled connection until the idle
    // timeout (R1).
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const { trx, record } = createFakeTrx();
      const gate = createGate();
      void openTrx(state, "core", async () => {
        await gate.opened;
        return trx;
      });

      const finishing = finishAuditRequest(true);
      expect(record.commits).toBe(0);
      gate.release();
      await finishing;

      expect(record).toMatchObject({ commits: 1, rollbacks: 0 });
    });
  });
});

describe("isAmbientAuditActive — when db() may hand out the ambient facade", () => {
  const armed = (method = "POST"): AuditRequestState => {
    const state = captureState(fakeRequest({ method }));
    state.armed = true;
    return state;
  };

  it("is false with no state at all — a job, a script, a unit test", () => {
    expect(isAmbientAuditActive(undefined)).toBe(false);
    expect(isAmbientAuditActive(getAuditState())).toBe(false);
  });

  it("is false before armAudit has run", () => {
    const state = captureState(fakeRequest({ method: "POST" }));

    expect(isAmbientAuditActive(state)).toBe(false);
  });

  it("is false for a GET, armed or not — P1 must not touch reads", () => {
    expect(isAmbientAuditActive(armed("GET"))).toBe(false);
  });

  it("is true for an armed mutating request", () => {
    expect(isAmbientAuditActive(armed())).toBe(true);
  });

  it("is false once detached", () => {
    const state = armed();
    state.detached = true;

    expect(isAmbientAuditActive(state)).toBe(false);
  });

  it("is false once finished — a late query must not touch a closed trx", () => {
    const state = armed();
    state.finished = true;

    expect(isAmbientAuditActive(state)).toBe(false);
  });

  it("goes live at armAudit and dies at finishAuditRequest", async () => {
    const req = fakeRequest({ method: "POST" });

    await runInContext(req, async (state) => {
      expect(isAmbientAuditActive(state)).toBe(false);

      await armAudit(req);
      expect(isAmbientAuditActive(state)).toBe(true);

      await finishAuditRequest(true);
      expect(isAmbientAuditActive(state)).toBe(false);
    });
  });

  it("stays false for the rest of a request that detached before arming", async () => {
    const req = fakeRequest({ method: "POST" });

    await runInContext(req, async (state) => {
      detachAuditRequest();
      await armAudit(req);

      expect(state.armed).toBe(true);
      expect(isAmbientAuditActive(state)).toBe(false);
    });
  });

  it("is true inside withAuditContext, and false again outside it", async () => {
    await withAuditContext(
      { source: "job", username: "reminder" },
      async () => {
        expect(isAmbientAuditActive(getAuditState())).toBe(true);
      },
    );

    expect(isAmbientAuditActive(getAuditState())).toBe(false);
  });
});

describe("setAuditAction", () => {
  it("names the action and re-applies the setting to every open transaction", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const core = createFakeTrx();
      const erp = createFakeTrx();
      await openTrx(state, "core", () => Promise.resolve(core.trx));
      await openTrx(state, "erp", () => Promise.resolve(erp.trx));

      await setAuditAction("customer.update");

      expect(state.action).toBe("customer.update");
      expect(settingsWritten(core.record)).toEqual([
        expect.objectContaining({ action: null }),
        expect.objectContaining({ action: "customer.update" }),
      ]);
      expect(settingsWritten(erp.record)).toEqual([
        expect.objectContaining({ action: null }),
        expect.objectContaining({ action: "customer.update" }),
      ]);
    });
  });

  it("is a no-op outside a request — a job or a test must not blow up", async () => {
    await expect(setAuditAction("seed.run")).resolves.toBeUndefined();
  });
});

describe("detachAuditRequest", () => {
  it("detaches the current request, one way", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      detachAuditRequest();
      expect(state.detached).toBe(true);

      // Nothing re-attaches: arming a detached request leaves it detached.
      await armAudit(fakeRequest({ method: "POST" }));
      detachAuditRequest();

      expect(state.detached).toBe(true);
    });
  });

  it("is a no-op outside a request", () => {
    expect(() => detachAuditRequest()).not.toThrow();
  });
});

describe("finishAuditRequest", () => {
  it("commits every open transaction when the response is a success", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const core = createFakeTrx();
      const erp = createFakeTrx();
      await openTrx(state, "core", () => Promise.resolve(core.trx));
      await openTrx(state, "erp", () => Promise.resolve(erp.trx));

      await finishAuditRequest(true);

      expect(core.record).toMatchObject({ commits: 1, rollbacks: 0 });
      expect(erp.record).toMatchObject({ commits: 1, rollbacks: 0 });
      expect(state.finished).toBe(true);
    });
  });

  it("rolls every open transaction back when the response failed", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const core = createFakeTrx();
      await openTrx(state, "core", () => Promise.resolve(core.trx));

      await finishAuditRequest(false);

      expect(core.record).toMatchObject({ commits: 0, rollbacks: 1 });
    });
  });

  it("is one-way: a second call never touches the transactions again", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const core = createFakeTrx();
      await openTrx(state, "core", () => Promise.resolve(core.trx));

      await finishAuditRequest(true);
      // `res.end` and the socket `close` handler both fire on a normal
      // response; the second must not roll back what the first committed.
      await finishAuditRequest(false);

      expect(core.record).toMatchObject({ commits: 1, rollbacks: 0 });
    });
  });

  it("skips a transaction that already completed itself", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      const core = createFakeTrx({ completed: true });
      await openTrx(state, "core", () => Promise.resolve(core.trx));

      await finishAuditRequest(true);

      expect(core.record).toMatchObject({ commits: 0, rollbacks: 0 });
    });
  });

  it("still finishes the other keys when one commit fails, then throws", async () => {
    const failing = createFakeTrx({ failOn: "commit" });
    const healthy = createFakeTrx();

    const thrown = await runInContext(
      fakeRequest({ method: "POST" }),
      async (state) => {
        await openTrx(state, "core", () => Promise.resolve(failing.trx));
        await openTrx(state, "erp", () => Promise.resolve(healthy.trx));

        return finishAuditRequest(true).catch((error: unknown) => error);
      },
    );

    // A key left open holds a pooled connection until the idle timeout (R1).
    expect(healthy.record.commits).toBe(1);
    expect(thrown).toBeInstanceOf(AuditCommitError);
    expect((thrown as AuditCommitError).failures.map((f) => f.key)).toEqual([
      "core",
    ]);
  });

  it("is a no-op outside a request", async () => {
    await expect(finishAuditRequest(true)).resolves.toBeUndefined();
  });
});

describe("AC-8 — withAuditContext", () => {
  it("runs the callback inside an armed state carrying the given source", async () => {
    let seen: AuditRequestState | undefined;

    const out = await withAuditContext(
      { source: "script", username: "test", companyId: 9 },
      async () => {
        seen = getAuditState();
        return "done";
      },
    );

    expect(out).toBe("done");
    expect(seen?.source).toBe("script");
    expect(seen?.mutating).toBe(true);
    expect(seen?.armed).toBe(true);
    expect(seen?.detached).toBe(false);
    expect(seen?.actor).toStrictEqual({
      userId: null,
      username: "test",
      role: null,
      actorCompanyId: null,
      companyId: 9,
    });
    expect(seen?.requestId).toMatch(UUID_PATTERN);
  });

  it("commits everything the callback opened", async () => {
    const erp = createFakeTrx();

    await withAuditContext(
      { source: "job", username: "reminder" },
      async () => {
        const state = getAuditState();
        if (!state) {
          throw new Error("withAuditContext ran its callback with no state");
        }
        await openTrx(state, "erp", () => Promise.resolve(erp.trx));
      },
    );

    expect(erp.record).toMatchObject({ commits: 1, rollbacks: 0 });
    expect(settingsWritten(erp.record)).toEqual([
      expect.objectContaining({ source: "job", username: "reminder" }),
    ]);
  });

  it("rolls back and rethrows the ORIGINAL error when the callback throws", async () => {
    const erp = createFakeTrx();
    const boom = new Error("the seed failed");

    await expect(
      withAuditContext({ source: "seed", username: "seeder" }, async () => {
        const state = getAuditState();
        if (!state) {
          throw new Error("withAuditContext ran its callback with no state");
        }
        await openTrx(state, "erp", () => Promise.resolve(erp.trx));
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(erp.record).toMatchObject({ commits: 0, rollbacks: 1 });
  });

  it("rethrows the callback's error even when the rollback also fails", async () => {
    const erp = createFakeTrx({ failOn: "rollback" });
    const boom = new Error("the script failed");

    await expect(
      withAuditContext({ source: "script", username: "scripter" }, async () => {
        const state = getAuditState();
        if (!state) {
          throw new Error("withAuditContext ran its callback with no state");
        }
        await openTrx(state, "erp", () => Promise.resolve(erp.trx));
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("leaves the store empty afterwards, on both paths", async () => {
    await withAuditContext(
      { source: "job", username: "reminder" },
      async () => undefined,
    );
    expect(getAuditState()).toBeUndefined();

    await withAuditContext(
      { source: "job", username: "reminder" },
      async () => {
        throw new Error("nope");
      },
    ).catch(() => undefined);
    expect(getAuditState()).toBeUndefined();
  });

  it("does not leak into a surrounding request state", async () => {
    await runInContext(fakeRequest({ method: "POST" }), async (state) => {
      await withAuditContext(
        { source: "job", username: "reminder" },
        async () => {
          expect(getAuditState()).not.toBe(state);
        },
      );

      expect(getAuditState()).toBe(state);
      expect(state.finished).toBe(false);
    });
  });
});
