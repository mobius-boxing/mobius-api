import { knex, Knex } from "knex";
import pg from "pg";
import { DB_KEYS, DbKey } from "./keys";
import { connectionFor } from "./env";
import { DOMAIN_OWNER, ownerOf } from "./ownership";
import {
  applyAuditSetting,
  getAuditState,
  isAmbientAuditActive,
  type AuditRequestState,
} from "./audit-context";

/**
 * Keep PG `DATE` (oid 1082) as the 'YYYY-MM-DD' string it already is.
 *
 * node-postgres otherwise parses it into a Date at LOCAL midnight, which for any
 * server west of the value's own calendar prints as the previous day — the exact
 * bug DATE columns exist to avoid. The countdown module's `dueDate` is the only
 * DATE column in the schema today, and "vence el 5" must never render as the 4th.
 * Process-global by nature: pg has one parser registry, shared by every pool.
 */
pg.types.setTypeParser(1082, (value: string) => value);

/**
 * Connections per key (AC-44, Q-2 default). `max_connections` is 100 on a
 * `traffic-postgres` shared with rolpel-api, rookito-api, the legacy
 * countdown-api and ad-hoc psql, on a t3.micro with 916 MB RAM — four pools in
 * one process must not multiply what used to be one pool of 15.
 */
export const POOL_MAX: Record<DbKey, number> = {
  core: 12,
  erp: 15,
  countdown: 5,
  nodefiles: 5,
};
// sum = 37 of a 40 budget. The 5 freed by deleting the store key on 2026-08-24
// were reserved for the `nodefiles` module (amendment-2026-08-24) and are now
// spent: node-files Phase 1 took them, and the extraction worker lives inside
// this budget — which is exactly why it never holds a connection across an LLM
// call (see node-files-worker.ts).

/** The ceiling `sum(POOL_MAX)` may not exceed. Asserted by unit test. */
export const POOL_BUDGET = 40;

/** Idle connections are not free on a t3.micro: only the hot keys keep one. */
const POOL_MIN: Record<DbKey, number> = {
  core: 1,
  erp: 1,
  countdown: 0,
  nodefiles: 0,
};

const IDLE_TIMEOUT_MS = 20000;
const ACQUIRE_TIMEOUT_MS = 30000;

export class DatabaseNotConnectedError extends Error {
  constructor(key: DbKey) {
    super(
      `Knex connection for "${key}" has not been established. Call connectAll() first.`,
    );
    this.name = "DatabaseNotConnectedError";
  }
}

export class WrongDatabaseError extends Error {
  constructor(table: string, requested: DbKey, owner: DbKey) {
    super(
      `Table "${table}" is owned by the "${owner}" database but was queried on the "${requested}" connection.`,
    );
    this.name = "WrongDatabaseError";
  }
}

type Callable = (...args: unknown[]) => unknown;

/**
 * `products as p`, `products p`, `public.products`, `"products"` → `products`.
 * Case is preserved, so `("COMPANIES")` does not resolve and is not rejected.
 */
const bareTableName = (value: string): string => {
  const withoutAsAlias =
    value
      .trim()
      .split(/\s+as\s+/i)[0]
      ?.trim() ?? "";
  // `("companies c")` is the same alias with the keyword left out.
  const withoutAlias = withoutAsAlias.split(/\s+/)[0] ?? withoutAsAlias;
  const segments = withoutAlias.split(".");
  const last = segments[segments.length - 1] ?? withoutAlias;
  return last.replace(/"/g, "");
};

/**
 * Wrong-database guard (AC-6, risk R4).
 *
 * A missed call site must fail loudly rather than quietly read a stale copy
 * after a cutover. Outside production that means throwing; in production a
 * split-brain read is still better than a 500, so it is logged and allowed —
 * the parked `zz_old_*` copies are what makes such a read fail there anyway.
 *
 * **What this actually covers**, stated exactly, because a guard trusted beyond
 * its reach is worse than none:
 *
 * - Guarded: the callable itself — `db(k)("table")`, including the generic form
 *   `db(k)<IRow>("table")`; the same on a `trx` from `db(k).transaction`, in
 *   **both** its callback and its callback-less (`await …transaction()`) forms;
 *   and the instance-level table shortcuts listed in `TABLE_NAMING_METHODS`.
 *   Aliases (`"t as a"`, `"t a"`), schema qualifiers and quotes are stripped
 *   first.
 * - NOT guarded — the query builder is never proxied, so nothing reached
 *   *through* it is checked: `.join` / `.leftJoin` / `.innerJoin`, `.from` and
 *   `.into` on a builder, `.queryBuilder().from(…)`, `.withSchema(…).from(…)`.
 *   Nor is an object alias (`db(k)({ c: "companies" })`) or a differently-cased
 *   name (`"COMPANIES"`) — only bare strings that resolve in the manifest.
 * - `knex.raw()` is logged, never rejected — see `attachRawBoundaryLogger`.
 * - A table with no single owner (`files`, `audit_logs`, anything unknown such
 *   as `knex_migrations`) is never rejected: the caller's key is the answer.
 *
 * **It is not exercised by `npm test`.** Every DAO test mocks this module, so
 * no unit test routes through the Proxy except `registry.test.ts` itself. Its
 * only live net is a run against a real database — the boundary-crossing joins
 * that T2a/T2b remove are precisely the ones it cannot see today.
 */
const rejectWrongDatabase = (key: DbKey, target: unknown): void => {
  if (typeof target !== "string") return;
  const table = bareTableName(target);
  const owner = ownerOf(table);
  if (!owner || owner === key) return;
  const error = new WrongDatabaseError(table, key, owner);
  if (process.env.NODE_ENV === "production") {
    console.error(`[db] ${error.message}`);
    return;
  }
  throw error;
};

const wrapTransaction =
  (instance: Knex, key: DbKey) =>
  (...args: unknown[]): unknown => {
    // Bound: knex's `transaction` reaches for `this.client`, so handing the
    // bare method out of the Proxy would call it with no receiver.
    const transaction = instance.transaction.bind(instance) as Callable;
    const [callback, ...rest] = args;

    // Callback-less form: `const trx = await db(k).transaction()`. Knex resolves
    // the promise with a bare transaction handle, which would otherwise leave
    // the Proxy behind entirely. No call site uses it today; it is wrapped so
    // the coverage list above stays true rather than gaining an exception.
    if (typeof callback !== "function") {
      return Promise.resolve(transaction(...args)).then((trx) =>
        guard(trx as Knex.Transaction, key),
      );
    }

    // The trx handed to the callback carries the same key, which is what makes
    // a cross-key `trx("table")` throw instead of silently succeeding.
    const guardedCallback = (trx: Knex.Transaction): unknown =>
      (callback as (t: Knex.Transaction) => unknown)(guard(trx, key));
    return transaction(guardedCallback, ...rest);
  };

/**
 * Instance-level shortcuts that name a table exactly as the callable does.
 * Nothing in the codebase uses them today; they are wrapped so the obvious next
 * way of reaching a foreign table is closed rather than discovered later.
 * (The identically-named *builder* methods are out of reach — see above.)
 */
const TABLE_NAMING_METHODS = new Set(["from", "table", "into"]);

const guard = <T extends object>(target: T, key: DbKey): T =>
  new Proxy(target, {
    apply(fn, thisArg, args: unknown[]) {
      rejectWrongDatabase(key, args[0]);
      return Reflect.apply(fn as unknown as Callable, thisArg, args);
    },
    get(obj, prop) {
      if (prop === "transaction") return wrapTransaction(obj as Knex, key);
      const value = Reflect.get(obj, prop);
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && TABLE_NAMING_METHODS.has(prop)) {
        return (...args: unknown[]): unknown => {
          rejectWrongDatabase(key, args[0]);
          return (value as Callable).apply(obj, args);
        };
      }
      return value.bind(obj);
    },
  }) as T;

/**
 * `knex.raw()` names its tables inside a SQL string, where neither trap can see
 * them. The one raw cross-boundary query today is countdown's `findDue`, so raw
 * SQL is logged rather than rejected, and only outside production.
 */
const FOREIGN_TABLE_PATTERN: Record<DbKey, RegExp> = DB_KEYS.reduce(
  (patterns, key) => {
    const foreign = Object.keys(DOMAIN_OWNER).filter((table) => {
      const owner = ownerOf(table);
      return owner !== undefined && owner !== key;
    });
    return { ...patterns, [key]: new RegExp(`\\b(${foreign.join("|")})\\b`) };
  },
  {} as Record<DbKey, RegExp>,
);

const attachRawBoundaryLogger = (instance: Knex, key: DbKey): void => {
  if (process.env.NODE_ENV === "production") return;
  instance.on("query", (query: { sql?: string; method?: string }) => {
    // Builder-generated queries carry their verb ("select", "insert", …) and
    // are already covered by the callable guard; only raw SQL reaches here.
    if (query.method !== "raw" || typeof query.sql !== "string") return;
    const match = FOREIGN_TABLE_PATTERN[key].exec(query.sql);
    if (!match) return;
    console.warn(
      `[db] raw query on "${key}" mentions "${match[1]}", owned by "${ownerOf(match[1] ?? "")}"`,
    );
  });
};

const instances = new Map<DbKey, Knex>();
const facades = new Map<DbKey, Knex>();

/**
 * The ambient (per-request) transaction facade — audit P1, handbook §P1.3.
 *
 * `db(key)` is synchronous and every DAO calls it per method; opening a
 * transaction is asynchronous. So the request's transaction cannot be handed to
 * a DAO at `db()` time — instead the builders `db()` hands out **defer binding
 * to the transaction until they are awaited**. This is the whole design: no DAO
 * signature changes, and no request holds a pooled connection it has not yet
 * used. Do not replace it with "open a transaction at request start" (that
 * spends one connection on all four pools for every mutating request, against
 * budgets of 12/15/5/5) or with "pass `trx` into every DAO" (the change this
 * exists to avoid).
 *
 * **How it composes with the wrong-database guard.** There are two Proxies, and
 * the order matters: `ambientFacade` wraps the **guarded** facade, never the raw
 * instance. Its `apply` trap calls `guarded(...args)`, so `rejectWrongDatabase`
 * still runs — and still throws — *before* anything is deferred; its `get` trap
 * reads through the guarded object, so `from`/`table`/`into` keep the guard's
 * table check and `transaction` keeps `wrapTransaction`. A `WrongDatabaseError`
 * that stops firing under an armed request is a stop condition, not a
 * behaviour change (§P1.8). `ensureTrx`, by contrast, opens on the **raw**
 * instance: `wrapTransaction` re-guards the handle it resolves, so opening
 * through the guarded facade would guard it twice.
 *
 * **Deliberate exemptions**, stated rather than discovered:
 * - `fn` (61 files reach `knex.fn.now()`) is a non-function member used as a
 *   *value* inside an update payload and never awaited. It passes straight
 *   through, unbound: deferring it would put a promise where the column value
 *   goes and the write would silently store garbage.
 * - `schema` (`sales-order-lifecycle.dao.ts:136,139`,
 *   `production-route.dao.ts:655`) also passes through, so `hasTable`/
 *   `hasColumn` probe on the plain pool, outside the request's transaction.
 *   Accepted: they are read-only introspection, and DDL-shaped probes have no
 *   business in a request's write transaction.
 * - `batchInsert`, `queryBuilder` and `ref` are not bound either. None appears
 *   anywhere in `src/` (verified); a future `batchInsert` call site would
 *   execute outside the ambient transaction and must be bound here first.
 *
 * **Two assumptions the design rests on.** (1) No DAO caches `db(key)` in a
 * class field or a module-level const — verified by grep; a cached facade would
 * be held across requests and bind queries to a finished transaction. (2) knex
 * query-builder methods mutate and return `this`, so the own `then` installed on
 * the builder survives the whole chain, and `catch`/`finally` route through it
 * (`knex/lib/builder-interface-augmenter.js:107`, `util/finally-mixin.js`).
 */
const ambientFacades = new WeakMap<AuditRequestState, Map<DbKey, Knex>>();

/**
 * One transaction per key per request, opened on the first awaited query.
 *
 * The **promise** is memoised, never the resolved handle: two builders awaited
 * concurrently both arrive here before either transaction exists, and memoising
 * the handle would let both open one — the request would then write through two
 * transactions, only one of which the middleware commits.
 */
const ensureTrx = (
  instance: Knex,
  key: DbKey,
  state: AuditRequestState,
): Promise<Knex.Transaction> => {
  const pending = state.trx.get(key);
  if (pending) return pending;
  const opening = (async (): Promise<Knex.Transaction> => {
    // Callback-less: a bare handle the middleware commits or rolls back itself.
    const trx = await instance.transaction();
    await applyAuditSetting(trx, state);
    return trx;
  })();
  state.trx.set(key, opening);
  return opening;
};

type Fulfilled = ((value: unknown) => unknown) | undefined | null;
type Rejected = ((reason: unknown) => unknown) | undefined | null;

/** A knex query builder or raw, seen only as "awaitable and bindable". */
type DeferrableQuery = {
  then: (onFulfilled?: Fulfilled, onRejected?: Rejected) => unknown;
  transacting: (trx: Knex.Transaction) => unknown;
};

/**
 * Defer binding a builder/raw to the request's transaction until it is awaited.
 *
 * Knex builders are thenables whose `then` lives on the prototype; an own `then`
 * shadows it. `catch`/`finally` delegate to `this.then()`, so they follow.
 * `transacting()` is idempotent (it re-points `this.client`), so a builder
 * awaited twice is safe.
 */
const bindLazily = <T>(
  target: T,
  instance: Knex,
  key: DbKey,
  state: AuditRequestState,
): T => {
  const query = target as DeferrableQuery;
  const originalThen = query.then.bind(query);
  query.then = (onFulfilled?: Fulfilled, onRejected?: Rejected): unknown => {
    // Read at AWAIT time, not at build time: after the response ended, a late
    // query must run on the pool rather than on a closed transaction.
    const bound = state.finished
      ? Promise.resolve()
      : ensureTrx(instance, key, state).then((trx) => {
          query.transacting(trx);
        });
    return bound.then(() => originalThen()).then(onFulfilled, onRejected);
  };
  return target;
};

const ambientFacade = (
  instance: Knex,
  guarded: Knex,
  key: DbKey,
  state: AuditRequestState,
): Knex =>
  new Proxy(guarded, {
    apply(_fn, _thisArg, args: unknown[]) {
      // `guarded(table)` first: the wrong-database check must still throw, and
      // must throw synchronously. Only the execution is deferred.
      return bindLazily(
        (guarded as unknown as Callable)(...args),
        instance,
        key,
        state,
      );
    },
    get(obj, prop) {
      if (prop === "transaction") {
        // A DAO that opens its own transaction (35 sites) becomes a SAVEPOINT on
        // the request's transaction — knex 3.1 does this natively
        // (`execution/transaction.js:118,293-295,318`: nested `commit` is
        // `RELEASE SAVEPOINT`, nested `rollback` is `ROLLBACK TO SAVEPOINT`, so
        // an inner rollback leaves the outer transaction alive). `wrapTransaction`
        // guards the handle exactly as it does off the plain facade.
        return (...args: unknown[]): Promise<unknown> =>
          ensureTrx(instance, key, state).then((trx) =>
            wrapTransaction(trx as unknown as Knex, key)(...args),
          );
      }
      if (prop === "raw") {
        return (...args: unknown[]): unknown =>
          bindLazily(
            (Reflect.get(obj, prop) as Callable)(...args),
            instance,
            key,
            state,
          );
      }
      if (typeof prop === "string" && TABLE_NAMING_METHODS.has(prop)) {
        // Reached through `obj`, so the guard's own table check runs first.
        return (...args: unknown[]): unknown =>
          bindLazily(
            (Reflect.get(obj, prop) as Callable)(...args),
            instance,
            key,
            state,
          );
      }
      // Everything else — `fn`, `schema`, `client`, … — exactly as the guard
      // hands it out. See the exemptions in the block comment above.
      return Reflect.get(obj, prop);
    },
  });

/**
 * The connection for `key`. Throws before `connectAll()` has resolved, exactly
 * as the single `KnexManager.getConnection()` it replaces did (AC-3).
 *
 * Outside an armed mutating request this is byte-for-byte what it always was —
 * the plain guarded facade, autocommit, no Proxy layer. That is what makes the
 * facade inert until the middleware (P1 track T3) arms a request.
 */
export function db(key: DbKey): Knex {
  const facade = facades.get(key);
  if (!facade) throw new DatabaseNotConnectedError(key);
  const state = getAuditState();
  // One question, one home: `isAmbientAuditActive` owns the whole condition
  // (mutating && armed && !detached && !finished). Re-deriving the flags here
  // is how one of them goes missing without a test noticing.
  if (!isAmbientAuditActive(state)) return facade;
  const instance = instances.get(key);
  if (!instance) throw new DatabaseNotConnectedError(key);

  let perKey = ambientFacades.get(state);
  if (!perKey) {
    perKey = new Map();
    ambientFacades.set(state, perKey);
  }
  let ambient = perKey.get(key);
  if (!ambient) {
    ambient = ambientFacade(instance, facade, key, state);
    perKey.set(key, ambient);
  }
  return ambient;
}

/**
 * Build every pool and prove every one of them answers, before the first
 * request is served. Any failure destroys whatever was created and rethrows, so
 * `server.ts` can exit(1) rather than serve half a database (AC-3).
 *
 * Idempotent: a second call while connected is a no-op, which is what keeps the
 * budget log to exactly one line per process (AC-44).
 */
export async function connectAll(): Promise<void> {
  if (facades.size === DB_KEYS.length) return;
  const created: Knex[] = [];
  try {
    for (const key of DB_KEYS) {
      const instance = knex({
        client: "pg",
        connection: connectionFor(key),
        pool: {
          min: POOL_MIN[key],
          max: POOL_MAX[key],
          idleTimeoutMillis: IDLE_TIMEOUT_MS,
          acquireTimeoutMillis: ACQUIRE_TIMEOUT_MS,
        },
      });
      created.push(instance);
      attachRawBoundaryLogger(instance, key);
      instances.set(key, instance);
      facades.set(key, guard(instance, key));
    }
    await Promise.all(created.map((instance) => instance.raw("SELECT 1")));
  } catch (error) {
    instances.clear();
    facades.clear();
    await Promise.all(
      created.map((instance) =>
        instance.destroy().catch((destroyError: unknown) => {
          console.error("Failed to destroy a half-open pool:", destroyError);
        }),
      ),
    );
    throw error;
  }

  const sum = Object.values(POOL_MAX).reduce((total, max) => total + max, 0);
  console.info("[db] pool budget", POOL_MAX, "sum", sum);
  console.info("Knex connections established");
}

export async function disconnectAll(): Promise<void> {
  const open = [...instances.values()];
  instances.clear();
  facades.clear();
  if (open.length === 0) return;
  await Promise.all(open.map((instance) => instance.destroy()));
  console.info("Knex connections closed");
}
