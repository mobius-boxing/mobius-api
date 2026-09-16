/**
 * `tenant-pools.ts` (db-per-company T7, model D-10, I-4, I-7, I-15).
 *
 * `knex` is mocked at the module boundary — these are unit tests of the pool
 * manager's own bookkeeping (cache TTL, budget/eviction, pin/head checks,
 * the C1 dedupe), never of Postgres. The two-database proof, the real budget
 * on `pg_stat_activity`, and a real pin mismatch live in
 * `tenant-pools.db.test.ts`.
 */
import fs from "fs";
import { migrationsDirectory } from "../../../database/migration-sets";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

const getLiveByCompanyId =
  jest.fn<(companyId: number) => Promise<Record<string, unknown> | null>>();
const getBuildingByCompanyId =
  jest.fn<(companyId: number) => Promise<Record<string, unknown> | null>>();

jest.mock("../../../dao/tenant-database/tenant-database.dao", () => ({
  TenantDatabaseDAO: function TenantDatabaseDAO() {
    return {
      getLiveByCompanyId: (id: number) => getLiveByCompanyId(id),
      getBuildingByCompanyId: (id: number) => getBuildingByCompanyId(id),
    };
  },
}));

const getServerById =
  jest.fn<(id: number) => Promise<Record<string, unknown> | null>>();

jest.mock("../../../dao/db-server/db-server.dao", () => ({
  DbServerDAO: function DbServerDAO() {
    return { getById: (id: number) => getServerById(id) };
  },
}));

const resolveCredential = jest.fn<() => Promise<string>>();

jest.mock("../../../database/credential-resolver", () => ({
  resolveCredential: () => resolveCredential(),
}));

const rawCoreInstance = jest.fn();
const guardedForTenant = jest.fn((instance: unknown) => instance);

jest.mock("../../../database/registry", () => ({
  rawCoreInstance: () => rawCoreInstance(),
  guardedForTenant: (instance: unknown) => guardedForTenant(instance),
}));

type FakeBuilder = { orderBy: jest.Mock; first: jest.Mock };
type FakeInstance = jest.Mock & {
  raw: jest.Mock;
  destroy: jest.Mock;
  client: {
    pool: { numUsed: () => number; numFree: () => number; max: number };
  };
};

// knex records `knex_migrations.name` WITH the file extension (confirmed
// against a real bootstrap): `00000000000000_baseline.ts`, not stripped.
// The current head is whichever tenant migration sorts last on disk — the
// same rule `latestTenantMigrationFile` applies — so later migrations do not
// turn an up-to-date instance into a "behind" one here.
const HEAD_NAME = fs
  .readdirSync(migrationsDirectory("tenant"))
  .filter((file) => file.endsWith(".ts") || file.endsWith(".js"))
  .sort()
  .reverse()[0];

const fakeInstance = (opts: {
  pin?: number | null;
  headName?: string;
  used?: number;
  max?: number;
}): FakeInstance => {
  const builder: FakeBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    first: jest
      .fn<() => Promise<{ name: string } | null>>()
      .mockResolvedValue(
        opts.headName === undefined ? null : { name: opts.headName },
      ),
  };
  const instance = jest.fn(() => builder) as unknown as FakeInstance;
  instance.raw = jest
    .fn<() => Promise<{ rows: Array<{ pin: number | string | null }> }>>()
    .mockResolvedValue({
      rows: [{ pin: opts.pin === undefined ? "7" : opts.pin }],
    });
  instance.destroy = jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  instance.client = {
    pool: {
      numUsed: () => opts.used ?? 0,
      numFree: () => (opts.max ?? 3) - (opts.used ?? 0),
      max: opts.max ?? 3,
    },
  };
  return instance;
};

jest.mock("knex", () => ({ __esModule: true, knex: jest.fn() }));

import { knex } from "knex";
import type {
  IDbServer,
  ITenantDatabase,
} from "../../../interfaces/tenant/tenant.interfaces";

const knexMock = knex as unknown as jest.Mock;

const row = (overrides: Partial<ITenantDatabase> = {}): ITenantDatabase => ({
  id: 1,
  uuid: "row-uuid",
  companyId: 7,
  serverId: 1,
  databaseName: "tenant_7_acme",
  dbUser: "tenant_7_acme_user",
  credentialRef: "enc:v1",
  credentialCiphertext: Buffer.from("x"),
  poolMax: 3,
  poolMin: 0,
  status: "active",
  schemaVersion: null,
  migrationState: "current",
  lastMigrationAt: null,
  lastMigrationError: null,
  provisionedAt: null,
  suspendedAt: null,
  suspendReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const server = (overrides: Partial<IDbServer> = {}): IDbServer => ({
  id: 1,
  uuid: "server-uuid",
  name: "mobius-postgres (shared)",
  kind: "shared_container",
  host: null,
  port: null,
  sslMode: "disable",
  adminUser: null,
  adminCredentialRef: null,
  adminCredentialCiphertext: null,
  connectionBudget: 6,
  isDefaultPlacement: true,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

import * as tenantPools from "../../../database/tenant-pools";

beforeEach(() => {
  process.env.SQL_DATABASE = "traffic_production";
  process.env.SQL_USER = "traffic_user";
  process.env.SQL_HOST = "localhost";
  resolveCredential.mockResolvedValue("secret");
  getServerById.mockResolvedValue(
    server() as unknown as Record<string, unknown>,
  );
  tenantPools.resetTenantPoolsForTest();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("acquireTenant — status mapping", () => {
  it("no row at all → unavailable", async () => {
    getLiveByCompanyId.mockResolvedValue(null);
    getBuildingByCompanyId.mockResolvedValue(null);

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution).toEqual({ kind: "unavailable", row: null });
  });

  it("a building row with status provisioning → provisioning", async () => {
    getLiveByCompanyId.mockResolvedValue(null);
    const building = row({ status: "provisioning" });
    getBuildingByCompanyId.mockResolvedValue(
      building as unknown as Record<string, unknown>,
    );

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("provisioning");
  });

  it("a building row with status failed → unavailable", async () => {
    getLiveByCompanyId.mockResolvedValue(null);
    getBuildingByCompanyId.mockResolvedValue(
      row({ status: "failed" }) as unknown as Record<string, unknown>,
    );

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("unavailable");
  });

  it("a suspended live row → suspended", async () => {
    getLiveByCompanyId.mockResolvedValue(
      row({ status: "suspended" }) as unknown as Record<string, unknown>,
    );

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("suspended");
  });

  it("a decommissioning live row → unavailable", async () => {
    getLiveByCompanyId.mockResolvedValue(
      row({ status: "decommissioning" }) as unknown as Record<string, unknown>,
    );

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("unavailable");
  });
});

describe("acquireTenant — D-31 shared-target dedupe (C1)", () => {
  it("a row whose databaseName equals core's own database resolves onto the core instance, no pool opened", async () => {
    getLiveByCompanyId.mockResolvedValue(
      row({ databaseName: "traffic_production" }) as unknown as Record<
        string,
        unknown
      >,
    );
    const core = fakeInstance({});
    rawCoreInstance.mockReturnValue(core);

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("ok");
    if (resolution.kind === "ok") {
      expect(resolution.handle.physicalKey).toBe("core");
      expect(resolution.handle.instance).toBe(core);
    }
    expect(knexMock).not.toHaveBeenCalled();
  });
});

describe("acquireTenant — pin and head checks (I-15, I-7)", () => {
  it("a mismatched pin returns 'unavailable' and logs an error (AC-37)", async () => {
    getLiveByCompanyId.mockResolvedValue(
      row() as unknown as Record<string, unknown>,
    );
    const instance = fakeInstance({ pin: 999, headName: HEAD_NAME });
    knexMock.mockReturnValue(instance);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("unavailable");
    expect(instance.destroy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("a stale knex_migrations head returns 'behind' and destroys the instance (AC-38)", async () => {
    getLiveByCompanyId.mockResolvedValue(
      row() as unknown as Record<string, unknown>,
    );
    const instance = fakeInstance({ pin: 7, headName: "20200101000000_old" });
    knexMock.mockReturnValue(instance);

    const resolution = await tenantPools.acquireTenant(7);

    expect(resolution.kind).toBe("behind");
    expect(instance.destroy).toHaveBeenCalled();
  });

  it("a matching pin and head opens and caches the instance", async () => {
    getLiveByCompanyId.mockResolvedValue(
      row() as unknown as Record<string, unknown>,
    );
    const instance = fakeInstance({ pin: 7, headName: HEAD_NAME });
    knexMock.mockReturnValue(instance);

    const first = await tenantPools.acquireTenant(7);
    const second = await tenantPools.acquireTenant(7);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    // Opened once: the second call reuses the cached instance (D-10).
    expect(knexMock).toHaveBeenCalledTimes(1);
  });
});

describe("acquireTenant — budget and LRU eviction (AC-39, I-4)", () => {
  it("evicts the idle LRU instance when a 3rd tenant would exceed the server's budget", async () => {
    const budgetServer = server({ connectionBudget: 6 });
    getServerById.mockResolvedValue(
      budgetServer as unknown as Record<string, unknown>,
    );

    const instanceA = fakeInstance({
      pin: 1,
      headName: HEAD_NAME,
      used: 0,
    });
    const instanceB = fakeInstance({
      pin: 2,
      headName: HEAD_NAME,
      used: 0,
    });
    const instanceC = fakeInstance({
      pin: 3,
      headName: HEAD_NAME,
      used: 0,
    });
    knexMock
      .mockReturnValueOnce(instanceA)
      .mockReturnValueOnce(instanceB)
      .mockReturnValueOnce(instanceC);

    getLiveByCompanyId.mockResolvedValueOnce(
      row({ id: 1, companyId: 1 }) as unknown as Record<string, unknown>,
    );
    const a = await tenantPools.acquireTenant(1);
    expect(a.kind).toBe("ok");

    getLiveByCompanyId.mockResolvedValueOnce(
      row({ id: 2, companyId: 2 }) as unknown as Record<string, unknown>,
    );
    const b = await tenantPools.acquireTenant(2);
    expect(b.kind).toBe("ok");

    // Budget is exactly full (3 + 3 = 6). A 3rd tenant must evict the LRU idle
    // one (A) to fit — never open a 41st/7th connection over budget.
    getLiveByCompanyId.mockResolvedValueOnce(
      row({ id: 3, companyId: 3 }) as unknown as Record<string, unknown>,
    );
    const c = await tenantPools.acquireTenant(3);

    expect(c.kind).toBe("ok");
    expect(instanceA.destroy).toHaveBeenCalled();
    expect(instanceB.destroy).not.toHaveBeenCalled();
    expect(tenantPools.tenantStats(1).open).toBe(false);
    expect(tenantPools.tenantStats(2).open).toBe(true);
    expect(tenantPools.tenantStats(3).open).toBe(true);
  });

  it("answers 'busy' when nothing open is idle (AC-39)", async () => {
    const budgetServer = server({ connectionBudget: 3 });
    getServerById.mockResolvedValue(
      budgetServer as unknown as Record<string, unknown>,
    );

    const instanceA = fakeInstance({
      pin: 1,
      headName: HEAD_NAME,
      used: 1, // busy: not evictable
    });
    knexMock.mockReturnValueOnce(instanceA);
    getLiveByCompanyId.mockResolvedValueOnce(
      row({ id: 1, companyId: 1 }) as unknown as Record<string, unknown>,
    );
    await tenantPools.acquireTenant(1);

    getLiveByCompanyId.mockResolvedValueOnce(
      row({ id: 2, companyId: 2 }) as unknown as Record<string, unknown>,
    );
    const busy = await tenantPools.acquireTenant(2);

    expect(busy.kind).toBe("busy");
    expect(knexMock).toHaveBeenCalledTimes(1);
  });

  it("mutation check: the sum of open poolMax never exceeds the server's budget", async () => {
    const budgetServer = server({ connectionBudget: 6 });
    getServerById.mockResolvedValue(
      budgetServer as unknown as Record<string, unknown>,
    );
    const instances = [1, 2, 3].map((id) =>
      fakeInstance({ pin: id, headName: HEAD_NAME, used: 0 }),
    );
    knexMock
      .mockReturnValueOnce(instances[0])
      .mockReturnValueOnce(instances[1])
      .mockReturnValueOnce(instances[2]);

    for (const id of [1, 2, 3]) {
      getLiveByCompanyId.mockResolvedValueOnce(
        row({ id, companyId: id, poolMax: 3 }) as unknown as Record<
          string,
          unknown
        >,
      );
      await tenantPools.acquireTenant(id);
    }

    const openSum = [1, 2, 3]
      .map((id) => tenantPools.tenantStats(id))
      .filter((stats) => stats.open)
      .reduce((sum, stats) => sum + stats.max, 0);
    expect(openSum).toBeLessThanOrEqual(6);
  });
});

describe("acquireTenant — registry cache TTL (AC-44, D-11)", () => {
  it("queries the DAO once per company within 60s, again after invalidation, again after the TTL", async () => {
    jest.useFakeTimers({ now: 0 });
    getLiveByCompanyId.mockResolvedValue(
      row({ status: "suspended" }) as unknown as Record<string, unknown>,
    );

    await tenantPools.acquireTenant(7);
    await tenantPools.acquireTenant(7);
    expect(getLiveByCompanyId).toHaveBeenCalledTimes(1);

    tenantPools.invalidateTenantCache(7);
    await tenantPools.acquireTenant(7);
    expect(getLiveByCompanyId).toHaveBeenCalledTimes(2);

    jest.setSystemTime(61_000);
    await tenantPools.acquireTenant(7);
    expect(getLiveByCompanyId).toHaveBeenCalledTimes(3);
  });
});

describe("TENANT_ERROR_RESPONSES / COMPANY_REQUIRED_BODY — model-exact bodies (D-23)", () => {
  it("matches the model's byte-exact strings", () => {
    expect(tenantPools.TENANT_ERROR_RESPONSES.provisioning).toEqual({
      status: 503,
      code: "TENANT_DB_PROVISIONING",
      message: "This company's database is being prepared. Retry shortly.",
      retryAfter: 15,
    });
    expect(tenantPools.TENANT_ERROR_RESPONSES.busy).toEqual({
      status: 503,
      code: "TENANT_DB_BUSY",
      message: "Too many companies active; retry.",
      retryAfter: 2,
    });
    expect(tenantPools.TENANT_ERROR_RESPONSES.suspended.status).toBe(403);
    expect(tenantPools.COMPANY_REQUIRED_BODY).toEqual({
      success: false,
      code: "COMPANY_REQUIRED",
      message:
        "This resource is company-scoped; superAdmins must specify companyId.",
    });
  });

  it("stays inside the ratified pool budget (I-4)", () => {
    expect(tenantPools.CORE_POOL_MAX).toBe(10);
    expect(tenantPools.POOL_BUDGET).toBe(40);
  });
});
