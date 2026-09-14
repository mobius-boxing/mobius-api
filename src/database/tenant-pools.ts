import fs from "fs";
import { knex, type Knex } from "knex";
import type { PhysicalKey } from "./keys";
import { connectionFor, connectionForTenant } from "./env";
import { resolveCredential } from "./credential-resolver";
import { migrationsDirectory } from "./migration-sets";
import type {
  IDbServer,
  ITenantDatabase,
} from "../interfaces/tenant/tenant.interfaces";

/**
 * Tenant pools (db-per-company T7, model D-10): a lazy per-tenant knex
 * instance, opened on first request, budgeted per server, LRU-evicted and
 * idle-destroyed. `tenant-context.middleware` and `registry.ts`'s `withTenant`
 * are the only two callers — everything else in this module is private.
 *
 * `CORE_POOL_MAX`/`POOL_BUDGET` move here from `registry.ts` (T3/D-116: they
 * stayed there "until T7"). `registry.ts` imports them back statically; this
 * module reaches the tenant/db-server DAOs (and hence `registry.ts`) only
 * through a **lazy** `import()` inside `acquireTenant`/`evictTenant`, the same
 * technique `audit-context.ts`'s `armAudit` uses to import `core-client.service`
 * — a static import in either direction here would close the cycle
 * `registry.ts` → `tenant-pools.ts` → a DAO → `registry.ts` at load time.
 */

export const TENANT_POOL_DEFAULT = { min: 0, max: 3 } as const;

/** An open-but-unused tenant instance is destroyed after this long (D-10). */
export const TENANT_POOL_IDLE_MS = 5 * 60 * 1000;

/** Moved from `registry.ts` (T3/D-116); was 12, now 10 (model D-10). */
export const CORE_POOL_MAX = 10;

/** The ceiling `CORE_POOL_MAX` plus every server's `connectionBudget` may reach. */
export const POOL_BUDGET = 40;

/** `db("tenant")` outside any request or `withTenant` scope, and no fallback applies. */
export class TenantNotResolvedError extends Error {
  constructor() {
    super(
      'db("tenant") was called inside a request that never resolved a ' +
        "company (db-per-company I-9); this is a bug in the route's plane " +
        "classification, not a missing company.",
    );
    this.name = "TenantNotResolvedError";
  }
}

export type TenantResolutionKind =
  | "provisioning"
  | "suspended"
  | "unavailable"
  | "behind"
  | "busy";

/** A `TenantResolution` other than `"ok"`, thrown by `withTenant` (model). */
export class TenantUnavailableError extends Error {
  constructor(
    readonly resolution: Extract<
      TenantResolution,
      { kind: TenantResolutionKind }
    >,
  ) {
    super(`Tenant database unavailable: ${resolution.kind}`);
    this.name = "TenantUnavailableError";
  }
}

/** `current_setting('mobius.company_id')` disagreed with the registry row (I-15). */
export class TenantPinMismatchError extends Error {
  constructor(
    readonly tenantDatabaseId: number,
    readonly expected: number,
    readonly actual: number | null,
  ) {
    super(
      `tenant_databases #${tenantDatabaseId}: expected pin ${expected}, ` +
        `database reports ${actual === null ? "no pin" : actual}`,
    );
    this.name = "TenantPinMismatchError";
  }
}

export type TenantHandle = {
  physicalKey: PhysicalKey;
  tenantDatabaseId: number;
  companyId: number;
  companyUuid: string;
  serverId: number;
  instance: Knex;
  guarded: Knex;
  openedAt: number;
  lastUsedAt: number;
};

export type TenantResolution =
  | { kind: "ok"; handle: TenantHandle }
  | { kind: TenantResolutionKind; row: ITenantDatabase | null };

/** The model's exact bodies for every `TENANT_*`/`COMPANY_REQUIRED` response (D-23, D-45). */
export const TENANT_ERROR_RESPONSES: Record<
  TenantResolutionKind,
  { status: number; code: string; message: string; retryAfter?: number }
> = {
  provisioning: {
    status: 503,
    code: "TENANT_DB_PROVISIONING",
    message: "This company's database is being prepared. Retry shortly.",
    retryAfter: 15,
  },
  unavailable: {
    status: 503,
    code: "TENANT_DB_UNAVAILABLE",
    message: "This company's database is unavailable.",
  },
  suspended: {
    status: 403,
    code: "TENANT_SUSPENDED",
    message: "This company is temporarily suspended.",
  },
  behind: {
    status: 503,
    code: "TENANT_DB_BEHIND",
    message: "This company's database schema is out of date.",
  },
  busy: {
    status: 503,
    code: "TENANT_DB_BUSY",
    message: "Too many companies active; retry.",
    retryAfter: 2,
  },
};

export const COMPANY_REQUIRED_BODY = {
  success: false,
  code: "COMPANY_REQUIRED",
  message:
    "This resource is company-scoped; superAdmins must specify companyId.",
} as const;

type OpenTenantInstance = {
  tenantDatabaseId: number;
  companyId: number;
  companyUuid: string;
  serverId: number;
  poolMax: number;
  instance: Knex;
  openedAt: number;
  lastUsedAt: number;
};

/** Live tenant instances, keyed by `tenant_databases.id`. Never the shared-target dedupe (D-31). */
const openInstances = new Map<number, OpenTenantInstance>();

type RegistryLookup = {
  live: ITenantDatabase | null;
  building: ITenantDatabase | null;
};
type CacheEntry = { value: RegistryLookup; expiresAt: number };

/** D-11: 60 s TTL, invalidated immediately by `invalidateTenantCache`. */
const REGISTRY_TTL_MS = 60_000;
const registryCache = new Map<number, CacheEntry>();

/** Called by a registry write (T9's `transition`/`create`) — cheap, in-process only. */
export function invalidateTenantCache(companyId: number): void {
  registryCache.delete(companyId);
}

/** Test-only: forget every open instance and cached row without destroying anything. */
export function resetTenantPoolsForTest(): void {
  openInstances.clear();
  registryCache.clear();
}

async function lookupRegistry(companyId: number): Promise<RegistryLookup> {
  const cached = registryCache.get(companyId);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs) return cached.value;
  const { TenantDatabaseDAO } =
    await import("../dao/tenant-database/tenant-database.dao");
  const dao = new TenantDatabaseDAO();
  const live = await dao.getLiveByCompanyId(companyId);
  const building = live ? null : await dao.getBuildingByCompanyId(companyId);
  const value = { live, building };
  registryCache.set(companyId, { value, expiresAt: nowMs + REGISTRY_TTL_MS });
  return value;
}

async function serverFor(serverId: number): Promise<IDbServer | null> {
  const { DbServerDAO } = await import("../dao/db-server/db-server.dao");
  return new DbServerDAO().getById(serverId);
}

/**
 * D-31: a `tenant_databases` row whose physical target IS the core database
 * (C1's shared-target rows). Identified by `databaseName`, the one column
 * D-31 pins to the core connection's own name — the pin/head/I-2 checks do
 * not apply to it (there is no pin, and its `knex_migrations` is core's).
 */
const isSharedTarget = (row: ITenantDatabase): boolean =>
  row.databaseName === connectionFor("core").database;

const now = (): number => Date.now();

const toHandle = (open: OpenTenantInstance, guarded: Knex): TenantHandle => ({
  physicalKey: `tenant:${open.tenantDatabaseId}`,
  tenantDatabaseId: open.tenantDatabaseId,
  companyId: open.companyId,
  companyUuid: "", // `tenant_databases` has no company uuid column; the caller (the middleware) already resolved one via `getCompanyScope` and overwrites this before storing the handle
  serverId: open.serverId,
  instance: open.instance,
  guarded,
  openedAt: open.openedAt,
  lastUsedAt: open.lastUsedAt,
});

/** `pool.numUsed()/numFree()` — knex exposes the underlying generic-pool client. */
export function tenantStats(tenantDatabaseId: number): {
  open: boolean;
  used: number;
  free: number;
  max: number;
} {
  const open = openInstances.get(tenantDatabaseId);
  if (!open) return { open: false, used: 0, free: 0, max: 0 };
  const pool = (open.instance as unknown as { client: { pool: GenericPool } })
    .client.pool;
  return {
    open: true,
    used: pool.numUsed(),
    free: pool.numFree(),
    max: pool.max,
  };
}

type GenericPool = {
  numUsed(): number;
  numFree(): number;
  max: number;
};

/** The newest tenant migration filename shipped in this image (I-7). */
const latestTenantMigrationFile = (): string => {
  const files = fs
    .readdirSync(migrationsDirectory("tenant"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".js"))
    .sort();
  const latest = files[files.length - 1];
  if (!latest) {
    throw new Error("No tenant migration files found in migrations/tenant/");
  }
  // knex's `knex_migrations.name` keeps the file extension (confirmed against
  // a real bootstrap: `00000000000000_baseline.ts`) — matching WITH it here,
  // not stripped, is what makes ts-node (dev) and the compiled `dist/*.js`
  // (prod) each compare against their own real head.
  return latest;
};

/**
 * Opens a fresh knex instance for `row`, pin-checks and head-checks it before
 * handing it back (I-7, I-15). Never caches on failure: the caller destroys a
 * mismatched instance and never re-tries it from `openInstances`.
 */
async function openTenantInstance(
  row: ITenantDatabase,
  server: IDbServer,
): Promise<{ ok: true; instance: Knex } | { ok: false; reason: "behind" }> {
  const password = await resolveCredential(
    row.credentialRef,
    row.credentialCiphertext,
  );
  const instance = knex({
    client: "pg",
    connection: connectionForTenant(row, server, password),
    pool: {
      min: row.poolMin,
      max: row.poolMax,
      idleTimeoutMillis: 20000,
      acquireTimeoutMillis: 30000,
    },
  });
  try {
    const pin = await instance.raw(
      "select current_setting('mobius.company_id', true) as pin",
    );
    const raw: string | null = pin.rows[0]?.pin ?? null;
    const actual = raw === null || raw === "" ? null : Number(raw);
    if (actual !== row.companyId) {
      throw new TenantPinMismatchError(row.id, row.companyId, actual);
    }

    const head = await instance("knex_migrations")
      .orderBy("id", "desc")
      .first("name");
    const expected = latestTenantMigrationFile();
    if (!head || head.name !== expected) {
      await instance.destroy().catch(() => undefined);
      return { ok: false, reason: "behind" };
    }

    return { ok: true, instance };
  } catch (error) {
    await instance.destroy().catch(() => undefined);
    throw error;
  }
}

/**
 * Evict every idle instance on `serverId` older-first until `needed` more
 * `poolMax` fits under `budget`, or there is nothing left to evict (AC-39).
 */
async function ensureBudget(
  server: IDbServer,
  needed: number,
): Promise<"ok" | "busy"> {
  const onServer = (): OpenTenantInstance[] =>
    [...openInstances.values()].filter((o) => o.serverId === server.id);
  const usedBudget = (): number =>
    onServer().reduce((sum, o) => sum + o.poolMax, 0);

  if (usedBudget() + needed <= server.connectionBudget) return "ok";

  const idleOldestFirst = onServer()
    .filter((o) => tenantStats(o.tenantDatabaseId).used === 0)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

  for (const candidate of idleOldestFirst) {
    if (usedBudget() + needed <= server.connectionBudget) break;
    await evictTenant(candidate.tenantDatabaseId);
  }

  return usedBudget() + needed <= server.connectionBudget ? "ok" : "busy";
}

/** D-10: an instance unused for `TENANT_POOL_IDLE_MS`, currently idle, is destroyed. */
async function sweepIdle(): Promise<void> {
  const stale = [...openInstances.values()].filter(
    (o) =>
      now() - o.lastUsedAt > TENANT_POOL_IDLE_MS &&
      tenantStats(o.tenantDatabaseId).used === 0,
  );
  for (const entry of stale) {
    await evictTenant(entry.tenantDatabaseId);
  }
}

/**
 * Destroy an open tenant instance, if any. `drainMs`, when given, is a soft
 * grace period: destroy waits for in-flight queries to return their
 * connections, but is not awaited past `drainMs` — the map entry is removed
 * either way, since a pool nobody can reach again must not keep counting
 * against the budget.
 */
export async function evictTenant(
  tenantDatabaseId: number,
  opts: { drainMs?: number } = {},
): Promise<void> {
  const open = openInstances.get(tenantDatabaseId);
  if (!open) return;
  openInstances.delete(tenantDatabaseId);
  const destroying = open.instance.destroy();
  if (opts.drainMs === undefined) {
    await destroying;
    return;
  }
  await Promise.race([
    destroying,
    new Promise((resolve) => setTimeout(resolve, opts.drainMs)),
  ]);
}

/** Every open tenant instance, destroyed — process shutdown (`disconnectAll`). */
export async function disconnectAllTenants(): Promise<void> {
  const ids = [...openInstances.keys()];
  for (const id of ids) {
    await evictTenant(id);
  }
}

/**
 * Resolve `companyId` to a servable tenant, opening a new instance only when
 * none is already open (D-10). Never throws for an expected outcome — every
 * "not ok" case is a `TenantResolution` the caller (the middleware, or
 * `registry.ts`'s `withTenant`) turns into a response or an error.
 */
export async function acquireTenant(
  companyId: number,
): Promise<TenantResolution> {
  await sweepIdle();
  const { live, building } = await lookupRegistry(companyId);

  if (!live) {
    if (building?.status === "provisioning") {
      return { kind: "provisioning", row: building };
    }
    return { kind: "unavailable", row: building ?? null };
  }
  if (live.status === "suspended") return { kind: "suspended", row: live };
  if (live.status === "decommissioning") {
    return { kind: "unavailable", row: live };
  }

  const server = await serverFor(live.serverId);
  if (!server) return { kind: "unavailable", row: live };

  if (isSharedTarget(live)) {
    const { rawCoreInstance, guardedForTenant } = await import("./registry");
    const instance = rawCoreInstance();
    return {
      kind: "ok",
      handle: {
        physicalKey: "core",
        tenantDatabaseId: live.id,
        companyId: live.companyId,
        companyUuid: "", // see toHandle
        serverId: live.serverId,
        instance,
        guarded: guardedForTenant(instance),
        openedAt: 0,
        lastUsedAt: now(),
      },
    };
  }

  const existing = openInstances.get(live.id);
  if (existing) {
    existing.lastUsedAt = now();
    const { guardedForTenant } = await import("./registry");
    return {
      kind: "ok",
      handle: toHandle(existing, guardedForTenant(existing.instance)),
    };
  }

  const budget = await ensureBudget(server, live.poolMax);
  if (budget === "busy") return { kind: "busy", row: live };

  try {
    const opened = await openTenantInstance(live, server);
    if (!opened.ok) return { kind: "behind", row: live };

    const entry: OpenTenantInstance = {
      tenantDatabaseId: live.id,
      companyId: live.companyId,
      companyUuid: "", // see toHandle
      serverId: live.serverId,
      poolMax: live.poolMax,
      instance: opened.instance,
      openedAt: now(),
      lastUsedAt: now(),
    };
    openInstances.set(live.id, entry);
    const { guardedForTenant } = await import("./registry");
    return {
      kind: "ok",
      handle: toHandle(entry, guardedForTenant(entry.instance)),
    };
  } catch (error) {
    if (error instanceof TenantPinMismatchError) {
      console.error(`[db] ${error.message}`);
      return { kind: "unavailable", row: live };
    }
    throw error;
  }
}
