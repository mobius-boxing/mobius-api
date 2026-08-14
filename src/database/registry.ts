import { knex, Knex } from "knex";
import pg from "pg";
import { DB_KEYS, DbKey } from "./keys";
import { connectionFor } from "./env";
import { DOMAIN_OWNER, ownerOf } from "./ownership";

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
  store: 5,
};

/** The ceiling `sum(POOL_MAX)` may not exceed. Asserted by unit test. */
export const POOL_BUDGET = 40;

/** Idle connections are not free on a t3.micro: only the hot keys keep one. */
const POOL_MIN: Record<DbKey, number> = {
  core: 1,
  erp: 1,
  countdown: 0,
  store: 0,
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
 * The connection for `key`. Throws before `connectAll()` has resolved, exactly
 * as the single `KnexManager.getConnection()` it replaces did (AC-3).
 */
export function db(key: DbKey): Knex {
  const facade = facades.get(key);
  if (!facade) throw new DatabaseNotConnectedError(key);
  return facade;
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
