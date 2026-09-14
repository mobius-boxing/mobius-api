/**
 * Tenant pools against REAL Postgres (db-per-company T7, model D-10, I-4, I-7,
 * I-15, I-16). Two scratch tenant databases prove company A's request never
 * reaches B's database, a pin mismatch and a stale `knex_migrations` head both
 * refuse to serve, the per-server budget is never exceeded (checked on
 * `pg_stat_activity`), and the ambient audit setting inside a tenant
 * transaction carries the pin.
 *
 * Needs a local database (same guard as `ambient-transaction.db.test.ts`) and
 * a role with CREATEDB for the two scratch tenant databases: `SQL_ADMIN_USER`/
 * `SQL_ADMIN_PASSWORD` when `SQL_USER` lacks it — never skipped, fails loudly
 * with the reason instead (L-013 sibling rule for this suite).
 *
 *   SQL_HOST=localhost SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production SQL_ADMIN_USER=… SQL_ADMIN_PASSWORD=… \
 *   npx jest src/__tests__/db/tenant-pools.db.test.ts --runInBand
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import {
  connectAll,
  disconnectAll,
  withTenant,
  db,
} from "../../database/registry";
import {
  acquireTenant,
  evictTenant,
  tenantStats,
  invalidateTenantCache,
} from "../../database/tenant-pools";
import { withAuditContext } from "../../database/audit-context";
import { CompanyDAO } from "../../dao/company/company.dao";
import { DbServerDAO } from "../../dao/db-server/db-server.dao";
import { TenantDatabaseDAO } from "../../dao/tenant-database/tenant-database.dao";
import {
  dbBootstrapDeps,
  scratchTenantDatabase,
  type DbBootstrapDeps,
} from "../../scripts/db-bootstrap";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);
// `mark` also names scratch tenant databases (`databaseName ~ '^[a-z][a-z0-9_]{0,62}$'`,
// no hyphens), so it uses underscores throughout rather than two spellings.
const mark = (suffix: string): string => `t7pool_${RUN}_${suffix}`;

type PidRow = { pid: number };
type SettingRow = { v: string | null };

describeIfLocalDb("Tenant pools against real Postgres (T7)", () => {
  let deps: DbBootstrapDeps;
  let admin: Client;
  let serverId = 0;
  let companyAId = 0;
  let companyBId = 0;
  let dbA = "";
  let dbB = "";
  let tenantRowAId = 0;
  let tenantRowBId = 0;

  const alterPin = async (
    database: string,
    companyId: number,
  ): Promise<void> => {
    await admin.query(
      `ALTER DATABASE "${database}" SET mobius.company_id = '${companyId}'`,
    );
  };

  const bootstrapScratchTenant = async (suffix: string): Promise<string> => {
    const database = scratchTenantDatabase(mark(suffix));
    const target = { set: "tenant" as const, database, mustNotExist: true };
    const connection = deps.connection();
    await deps.createDatabase(target, connection);
    await deps.migrate(target, connection);
    return database;
  };

  const registerTenant = async (
    companyId: number,
    databaseName: string,
  ): Promise<number> => {
    const created = await new TenantDatabaseDAO().create({
      uuid: `00000000-0000-4000-8000-${String(companyId).padStart(12, "0")}`,
      companyId,
      serverId,
      databaseName,
      dbUser: process.env.SQL_USER ?? "",
      credentialRef: "env:SQL_PASSWORD",
      credentialCiphertext: null,
      poolMax: 3,
      poolMin: 0,
    });
    await new TenantDatabaseDAO().transition(
      created.id,
      "provisioning",
      "active",
      {
        migrationState: "current",
      },
    );
    return created.id;
  };

  beforeAll(async () => {
    await connectAll();
    deps = dbBootstrapDeps(process.env);
    const connection = deps.connection();
    const adminUser = process.env.SQL_ADMIN_USER ?? connection.user;
    if (!process.env.SQL_ADMIN_USER) {
      throw new Error(
        "tenant-pools.db.test.ts needs SQL_ADMIN_USER/SQL_ADMIN_PASSWORD " +
          "(a role with CREATEDB) — never skipped (L-013 sibling rule).",
      );
    }
    admin = new Client({
      host: connection.host,
      port: connection.port,
      user: adminUser,
      password: process.env.SQL_ADMIN_PASSWORD,
      database: "postgres",
    });
    await admin.connect();

    const server = await new DbServerDAO().getDefaultPlacement();
    if (!server) throw new Error("no default-placement db_servers row");
    serverId = server.id;

    const companyDAO = new CompanyDAO();
    const companyA = await companyDAO.create({
      name: mark("A"),
      slug: mark("a").replace(/_/g, "-"),
    } as never);
    const companyB = await companyDAO.create({
      name: mark("B"),
      slug: mark("b").replace(/_/g, "-"),
    } as never);
    companyAId = companyA.id ?? 0;
    companyBId = companyB.id ?? 0;

    dbA = await bootstrapScratchTenant("a");
    dbB = await bootstrapScratchTenant("b");
    await alterPin(dbA, companyAId);
    await alterPin(dbB, companyBId);

    tenantRowAId = await registerTenant(companyAId, dbA);
    tenantRowBId = await registerTenant(companyBId, dbB);
  }, 60000);

  const resetBetweenCases = async (): Promise<void> => {
    await evictTenant(tenantRowAId);
    await evictTenant(tenantRowBId);
    invalidateTenantCache(companyAId);
    invalidateTenantCache(companyBId);
  };

  afterAll(async () => {
    await resetBetweenCases();
    for (const id of [tenantRowAId, tenantRowBId]) {
      if (id) await db("core")("tenant_databases").where("id", id).del();
    }
    for (const id of [companyAId, companyBId]) {
      if (id) await new CompanyDAO().delete(id);
    }
    for (const database of [dbA, dbB]) {
      if (database) await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin.end();
    await disconnectAll();
  }, 60000);

  it("routes company A's writes to A's database and never to B's (two-database proof)", async () => {
    const markerA = mark("marker-a");
    await withTenant(companyAId, async () => {
      await db("tenant")("warehouses").insert({ name: markerA, company_id: 1 });
    });

    const clientA = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: dbA,
    });
    const clientB = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: dbB,
    });
    await clientA.connect();
    await clientB.connect();
    try {
      const inA = await clientA.query(
        `SELECT count(*)::int AS c FROM warehouses WHERE name = $1`,
        [markerA],
      );
      const inB = await clientB.query(
        `SELECT count(*)::int AS c FROM warehouses WHERE name = $1`,
        [markerA],
      );
      expect(inA.rows[0].c).toBe(1);
      expect(inB.rows[0].c).toBe(0);
    } finally {
      await clientA.end();
      await clientB.end();
    }

    // Cleanup this row via the tenant connection itself.
    await withTenant(companyAId, async () => {
      await db("tenant")("warehouses").where("name", markerA).del();
    });
  }, 30000);

  it("AC-37: a pin mismatch refuses to serve (TenantPinMismatchError → 'unavailable')", async () => {
    await resetBetweenCases();
    await alterPin(dbB, companyAId); // deliberately wrong: B's database, A's pin
    try {
      const resolution = await acquireTenant(companyBId);
      expect(resolution.kind).toBe("unavailable");
    } finally {
      await alterPin(dbB, companyBId); // restore
      await resetBetweenCases();
    }
  }, 30000);

  it("AC-38: a stale knex_migrations head answers 'behind'", async () => {
    await resetBetweenCases();
    const clientB = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: dbB,
    });
    await clientB.connect();
    try {
      await clientB.query(
        `INSERT INTO knex_migrations (name, batch, migration_time) VALUES ($1, 999, now())`,
        [mark("fake-future-migration")],
      );
      const resolution = await acquireTenant(companyBId);
      expect(resolution.kind).toBe("behind");
    } finally {
      await clientB.query(`DELETE FROM knex_migrations WHERE name = $1`, [
        mark("fake-future-migration"),
      ]);
      await clientB.end();
      await resetBetweenCases();
    }
  }, 30000);

  it("AC-45 (I-16): the ambient audit setting inside a tenant transaction carries the pin", async () => {
    await resetBetweenCases();
    let seen: string | null = null;
    await withAuditContext(
      { source: "script", username: "t7-db-test", companyId: companyAId },
      async () => {
        await withTenant(companyAId, async () => {
          const result = await db("tenant").raw<{ rows: SettingRow[] }>(
            `select current_setting('mobius.audit', true)::jsonb->>'companyId' as v`,
          );
          seen = result.rows[0]?.v ?? null;
        });
      },
    );
    expect(Number(seen)).toBe(companyAId);
  }, 30000);

  it("AC-39/I-4: budget/eviction never exceeds the server's connectionBudget on pg_stat_activity", async () => {
    await resetBetweenCases();
    invalidateTenantCache(companyAId);
    invalidateTenantCache(companyBId);

    // Both scratch tenants share the real shared-server row's budget (30).
    // Opening both (poolMax 3 each) must never push total backends over the
    // ratified ceiling — asserted on a real pg_stat_activity count, not on
    // in-memory bookkeeping alone.
    const a = await acquireTenant(companyAId);
    const b = await acquireTenant(companyBId);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    if (a.kind === "ok") await a.handle.instance.raw("select 1");
    if (b.kind === "ok") await b.handle.instance.raw("select 1");

    const activity = await admin.query<PidRow>(
      `select pid from pg_stat_activity where datname in ($1, $2)`,
      [dbA, dbB],
    );
    expect(activity.rowCount ?? 0).toBeLessThanOrEqual(6);

    const statsA = tenantStats(tenantRowAId);
    const statsB = tenantStats(tenantRowBId);
    expect(statsA.max + statsB.max).toBeLessThanOrEqual(30);

    await evictTenant(tenantRowAId);
    await evictTenant(tenantRowBId);
  }, 30000);
});
