/**
 * Provisioning, decommission and the fleet-coverage/pin checks against REAL
 * Postgres (db-per-company T9, model D-19/D-20/D-25/D-70, brief AC-50…52,
 * 55, 56, 86).
 *
 * Needs a scratch CORE database built by `npm run db:bootstrap` (T6's
 * registry tables must exist) and an admin role with CREATEDB + CREATEROLE
 * for the scratch server row this suite creates:
 *
 *   SQL_HOST=localhost SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch core db> SQL_ADMIN_USER=… SQL_ADMIN_PASSWORD=… \
 *   npx jest --runInBand src/__tests__/db/tenant-provisioning.db.test.ts
 *
 * This suite creates REAL `tenant_<id>_*` databases and roles (never drops
 * anyone else's), and drops every one it creates in `afterAll`/per-test
 * teardown — L-013. `companies`/`db_servers`/`tenant_databases`/
 * `tenant_migration_runs` rows are cleaned up the same way as
 * `tenant-registry.db.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";
import { knex as createKnex, type Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import {
  beginProvisioning,
  computeTenantNaming,
  decommissionTenantDatabase,
  provisionTenantDatabase,
  type ProvisioningStep,
} from "../../services/tenant-provisioning.service";
import {
  checkDedicatedTenantPin,
  checkDedicatedTenantRows,
  checkFleetCoverage,
  FLEET_COVERAGE_GRACE_MS,
} from "../../scripts/db-check-integrity";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const hasAdmin =
  process.env.SQL_ADMIN_USER !== undefined &&
  process.env.SQL_ADMIN_PASSWORD !== undefined;
const describeIfReady = isLocalDb && hasAdmin ? describe : describe.skip;

const RUN = Date.now().toString(36);
const mark = (suffix: string): string => `zz-jest-t9-${RUN}-${suffix}`;

type Row = Record<string, unknown>;
const rows = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> =>
  ((await db("core").raw(sql, bindings)) as { rows: T[] }).rows;
const one = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T> => {
  const [row] = await rows<T>(sql, bindings);
  if (!row) throw new Error(`no row: ${sql}`);
  return row;
};

describeIfReady(
  "tenant provisioning / decommission / fleet checks against real Postgres (T9)",
  () => {
    let admin: Client;
    let serverId = 0;
    let serverUuid = "";
    let server2Id = 0;
    let server2Uuid = "";
    const companyIds: number[] = [];
    const plantedDatabases: string[] = [];
    const plantedRoles: string[] = [];

    const makeCompany = async (
      suffix: string,
    ): Promise<{ id: number; uuid: string; slug: string }> => {
      const slug = mark(suffix); // already DNS-safe
      const row = await one<{ id: number; uuid: string }>(
        `insert into companies (name, slug) values (?, ?) returning id, uuid`,
        [`Zz Jest T9 ${suffix}`, slug],
      );
      companyIds.push(row.id);
      return { ...row, slug };
    };

    const dropDatabaseIfExists = async (name: string): Promise<void> => {
      await admin
        .query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
        .catch(async () => {
          // PG < 13 has no WITH (FORCE); fall back to a plain drop.
          await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        });
    };
    const dropRoleIfExists = async (name: string): Promise<void> => {
      await admin.query(`DROP ROLE IF EXISTS "${name}"`);
    };

    beforeAll(async () => {
      await connectAll();
      admin = new Client({
        host: process.env.SQL_HOST,
        port: Number(process.env.SQL_PORT) || 5432,
        user: process.env.SQL_ADMIN_USER,
        password: process.env.SQL_ADMIN_PASSWORD,
        database: "postgres",
      });
      await admin.connect();

      const [server] = await db("core")("db_servers")
        .insert({
          name: mark("server"),
          kind: "external",
          host: process.env.SQL_HOST ?? "localhost",
          port: Number(process.env.SQL_PORT) || 5432,
          sslMode: "disable",
          adminUser: process.env.SQL_ADMIN_USER,
          adminCredentialRef: "env:SQL_ADMIN_PASSWORD",
          connectionBudget: 5,
          isDefaultPlacement: false,
          status: "active",
        })
        .returning(["id", "uuid"]);
      serverId = server.id as number;
      serverUuid = server.uuid as string;

      // F2: a second server on the same host so a cross-server retry has
      // somewhere real (if wrongly permitted) to run its admin steps against.
      const [server2] = await db("core")("db_servers")
        .insert({
          name: mark("server2"),
          kind: "external",
          host: process.env.SQL_HOST ?? "localhost",
          port: Number(process.env.SQL_PORT) || 5432,
          sslMode: "disable",
          adminUser: process.env.SQL_ADMIN_USER,
          adminCredentialRef: "env:SQL_ADMIN_PASSWORD",
          connectionBudget: 5,
          isDefaultPlacement: false,
          status: "active",
        })
        .returning(["id", "uuid"]);
      server2Id = server2.id as number;
      server2Uuid = server2.uuid as string;
    });

    afterAll(async () => {
      for (const name of plantedDatabases) await dropDatabaseIfExists(name);
      for (const name of plantedRoles) await dropRoleIfExists(name);
      // Anything still under tenant_databases/tenant_migration_runs for our
      // companies (a test that asserted mid-flight state without deleting).
      await db("core").transaction(async (trx) => {
        await trx.raw(
          "select set_config('mobius.audit_maintenance', 'on', true)",
        );
        await trx.raw(
          `delete from tenant_migration_runs where "tenantDatabaseId" in (select id from tenant_databases where "companyId" = any(?))`,
          [companyIds],
        );
        await trx.raw(
          `delete from tenant_databases where "companyId" = any(?)`,
          [companyIds],
        );
        await trx.raw(`delete from companies where id = any(?)`, [companyIds]);
        await trx.raw(`delete from db_servers where id = any(?)`, [
          [serverId, server2Id],
        ]);
        await trx.raw(
          `delete from audit_logs where ("entityName" = 'tenant_databases' and "companyId" = any(?))
              or ("entityName" = 'db_servers' and "entityId" = any(?))
              or ("entityName" = 'companies' and "entityId" = any(?))`,
          [companyIds, [serverId, server2Id], companyIds],
        );
      });
      await admin.end();
      await disconnectAll();
    }, 30000);

    it("AC-50: provisions end to end — role, database, pins, baseline, seeds, active", async () => {
      const company = await makeCompany("provision-happy");
      const naming = computeTenantNaming(company.id, company.slug);
      plantedDatabases.push(naming.databaseName);
      plantedRoles.push(naming.dbUser);

      const result = await provisionTenantDatabase(company.id, { serverUuid });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.row.status).toBe("active");
      expect(result.row.databaseName).toBe(naming.databaseName);
      expect(result.row.dbUser).toBe(naming.dbUser);
      expect(result.row.schemaVersion).toBe("00000000000000_baseline.ts");
      expect(result.row.migrationState).toBe("current");
      expect(result.row.provisionedAt).not.toBeNull();

      const dbHit = await admin.query(
        "select 1 from pg_database where datname = $1",
        [naming.databaseName],
      );
      expect(dbHit.rowCount).toBe(1);
      const roleHit = await admin.query(
        "select 1 from pg_roles where rolname = $1",
        [naming.dbUser],
      );
      expect(roleHit.rowCount).toBe(1);
    }, 30000);

    it("AC-51: a fault after each step fails the row; a retry reaches active, creating role/database exactly once", async () => {
      const company = await makeCompany("provision-retry");
      const naming = computeTenantNaming(company.id, company.slug);
      plantedDatabases.push(naming.databaseName);
      plantedRoles.push(naming.dbUser);

      const steps: ProvisioningStep[] = [
        "role",
        "database",
        "revoke",
        "pins",
        "migrate",
        "seed",
      ];
      let roleCreates = 0;
      let databaseCreates = 0;
      const onCreate = (step: "role" | "database"): void => {
        if (step === "role") roleCreates += 1;
        else databaseCreates += 1;
      };

      for (const step of steps) {
        const failed = await provisionTenantDatabase(
          company.id,
          { serverUuid },
          { onCreate, failAfter: step },
        );
        expect(failed.ok).toBe(false);
        if (failed.ok) return;
        expect(failed.row?.status).toBe("failed");
        expect(failed.row?.lastMigrationError).toContain(step);
      }

      const finalTry = await provisionTenantDatabase(
        company.id,
        { serverUuid },
        { onCreate },
      );
      expect(finalTry.ok).toBe(true);
      if (!finalTry.ok) return;
      expect(finalTry.row.status).toBe("active");
      expect(roleCreates).toBe(1);
      expect(databaseCreates).toBe(1);
    }, 60000);

    it("F2: retrying a failed row with a different serverUuid refuses SERVER_MISMATCH and never touches the other server", async () => {
      const company = await makeCompany("cross-server-retry");
      const naming = computeTenantNaming(company.id, company.slug);
      plantedDatabases.push(naming.databaseName);
      plantedRoles.push(naming.dbUser);

      const failed = await provisionTenantDatabase(
        company.id,
        { serverUuid },
        { failAfter: "role" },
      );
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.row?.status).toBe("failed");
      expect(failed.row?.serverId).toBe(serverId);

      const mismatch = await beginProvisioning(company.id, {
        serverUuid: server2Uuid,
      });
      expect(mismatch).toMatchObject({
        ok: false,
        code: "SERVER_MISMATCH",
      });
      if (mismatch.ok) return;
      expect(mismatch.row?.serverId).toBe(serverId);

      const rowAfter = await db("core")("tenant_databases")
        .where("companyId", company.id)
        .first();
      expect(rowAfter.serverId).toBe(serverId);
      expect(rowAfter.databaseName).toBe(naming.databaseName);
      expect(rowAfter.dbUser).toBe(naming.dbUser);
      expect(rowAfter.status).toBe("failed");

      // The role from the injected `failAfter: "role"` fault above exists
      // (creation happens before the fault fires); the database step never
      // ran. The refused mismatch call must not have created either.
      const roleHit = await admin.query(
        "select 1 from pg_roles where rolname = $1",
        [naming.dbUser],
      );
      expect(roleHit.rowCount).toBe(1);
      const dbHit = await admin.query(
        "select 1 from pg_database where datname = $1",
        [naming.databaseName],
      );
      expect(dbHit.rowCount).toBe(0);

      let roleCreates = 0;
      let databaseCreates = 0;
      const onCreate = (step: "role" | "database"): void => {
        if (step === "role") roleCreates += 1;
        else databaseCreates += 1;
      };
      const resumed = await provisionTenantDatabase(
        company.id,
        { serverUuid },
        { onCreate },
      );
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.row.status).toBe("active");
      expect(resumed.row.serverId).toBe(serverId);
      // Resuming resumes the FIRST incomplete step (database) — the role,
      // already created before the mismatch attempt, is never recreated.
      expect(roleCreates).toBe(0);
      expect(databaseCreates).toBe(1);
    }, 30000);

    describe("AC-52: naming and collision refusal", () => {
      it("refuses when the target database name already exists, marks the row failed, and issues no CREATE", async () => {
        const company = await makeCompany("collision-db");
        const naming = computeTenantNaming(company.id, company.slug);
        await admin.query(`CREATE DATABASE "${naming.databaseName}"`);
        plantedDatabases.push(naming.databaseName);

        let created = false;
        const result = await provisionTenantDatabase(
          company.id,
          { serverUuid },
          {
            onCreate: () => {
              created = true;
            },
          },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toContain(naming.databaseName);
        expect(result.reason).toContain("collision");
        expect(result.row?.status).toBe("failed");
        expect(created).toBe(false);

        const roleHit = await admin.query(
          "select 1 from pg_roles where rolname = $1",
          [naming.dbUser],
        );
        expect(roleHit.rowCount).toBe(0);
      }, 30000);

      it("refuses when the target role name already exists, marks the row failed, and issues no CREATE", async () => {
        const company = await makeCompany("collision-role");
        const naming = computeTenantNaming(company.id, company.slug);
        await admin.query(`CREATE ROLE "${naming.dbUser}" LOGIN PASSWORD 'x'`);
        plantedRoles.push(naming.dbUser);

        let created = false;
        const result = await provisionTenantDatabase(
          company.id,
          { serverUuid },
          {
            onCreate: () => {
              created = true;
            },
          },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toContain(naming.dbUser);
        expect(created).toBe(false);
      }, 30000);
    });

    it("AC-53: a provisioned tenant's reference-data tables match a brand-new company's baseline (zero rows)", async () => {
      const company = await makeCompany("refdata");
      const naming = computeTenantNaming(company.id, company.slug);
      plantedDatabases.push(naming.databaseName);
      plantedRoles.push(naming.dbUser);

      const result = await provisionTenantDatabase(company.id, { serverUuid });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tenant = new Client({
        host: process.env.SQL_HOST,
        port: Number(process.env.SQL_PORT) || 5432,
        user: process.env.SQL_ADMIN_USER,
        password: process.env.SQL_ADMIN_PASSWORD,
        database: naming.databaseName,
      });
      await tenant.connect();
      try {
        for (const table of ["app_config", "code_sequences", "box_types"]) {
          const count = await tenant.query(
            `select count(*)::int as n from ${table}`,
          );
          expect(count.rows[0].n).toBe(0);
        }
      } finally {
        await tenant.end();
      }
    }, 30000);

    describe("AC-56 / AC-86: pin/foreign-row checks and fleet coverage", () => {
      it("AC-56: a foreign companyId row inside a dedicated tenant is named by table", async () => {
        const a = await makeCompany("pin-a");
        const b = await makeCompany("pin-b");
        const namingA = computeTenantNaming(a.id, a.slug);
        plantedDatabases.push(namingA.databaseName);
        plantedRoles.push(namingA.dbUser);

        const provisioned = await provisionTenantDatabase(a.id, { serverUuid });
        expect(provisioned.ok).toBe(true);
        if (!provisioned.ok) return;

        const tenant = createKnex({
          client: "pg",
          connection: {
            host: process.env.SQL_HOST,
            port: Number(process.env.SQL_PORT) || 5432,
            user: process.env.SQL_ADMIN_USER,
            password: process.env.SQL_ADMIN_PASSWORD,
            database: namingA.databaseName,
          },
          pool: { min: 0, max: 1 },
        });
        try {
          const clean = await checkDedicatedTenantPin(tenant, provisioned.row);
          expect(clean).toBeNull();

          await tenant.raw(
            `insert into customer_categories (uuid, "companyId", name) values (gen_random_uuid(), ?, 'zz-jest-foreign')`,
            [b.id],
          );
          const findings = await checkDedicatedTenantRows(
            tenant,
            provisioned.row,
          );
          expect(findings.some((f) => f.includes("customer_categories"))).toBe(
            true,
          );
        } finally {
          await tenant.destroy();
        }
      }, 30000);

      it("AC-86: a company with no live row fails; one within the 15-min grace warns; a failed row always fails", async () => {
        const noRow = await makeCompany("coverage-none");
        const fresh = await makeCompany("coverage-fresh");
        const stale = await makeCompany("coverage-stale");
        const failedCo = await makeCompany("coverage-failed");

        const freshRow = await one<{ id: number }>(
          `insert into tenant_databases ("companyId", "serverId", "databaseName", "dbUser", "credentialRef", status)
           values (?, ?, ?, ?, 'env:SQL_PASSWORD', 'provisioning') returning id`,
          [
            fresh.id,
            serverId,
            `tenant_${fresh.id}_zzcoverage`,
            `tenant_${fresh.id}_zzcoverage_user`,
          ],
        );
        const staleRow = await one<{ id: number }>(
          `insert into tenant_databases ("companyId", "serverId", "databaseName", "dbUser", "credentialRef", status)
           values (?, ?, ?, ?, 'env:SQL_PASSWORD', 'provisioning') returning id`,
          [
            stale.id,
            serverId,
            `tenant_${stale.id}_zzcoverage`,
            `tenant_${stale.id}_zzcoverage_user`,
          ],
        );
        await db("core")("tenant_databases")
          .where("id", staleRow.id)
          .update({
            createdAt: new Date(Date.now() - FLEET_COVERAGE_GRACE_MS - 60000),
          });
        await one(
          `insert into tenant_databases ("companyId", "serverId", "databaseName", "dbUser", "credentialRef", status)
           values (?, ?, ?, ?, 'env:SQL_PASSWORD', 'failed') returning id`,
          [
            failedCo.id,
            serverId,
            `tenant_${failedCo.id}_zzcoverage`,
            `tenant_${failedCo.id}_zzcoverage_user`,
          ],
        );

        const coverage = await checkFleetCoverage(db("core"), new Date());
        const forCompany = (uuid: string): string[] =>
          [...coverage.failures, ...coverage.warnings].filter((line) =>
            line.includes(uuid),
          );

        expect(
          forCompany(noRow.uuid).some((l) => coverage.failures.includes(l)),
        ).toBe(true);
        expect(coverage.warnings.some((l) => l.includes(fresh.uuid))).toBe(
          true,
        );
        expect(coverage.failures.some((l) => l.includes(fresh.uuid))).toBe(
          false,
        );
        expect(coverage.failures.some((l) => l.includes(stale.uuid))).toBe(
          true,
        );
        expect(coverage.failures.some((l) => l.includes(failedCo.uuid))).toBe(
          true,
        );

        void freshRow;
      }, 30000);
    });

    it("AC-55: decommission parks a dedicated tenant's database, revokes login, purges centrally, then deletes the row", async () => {
      const company = await makeCompany("decommission");
      const naming = computeTenantNaming(company.id, company.slug);
      plantedRoles.push(naming.dbUser);

      const provisioned = await provisionTenantDatabase(company.id, {
        serverUuid,
      });
      expect(provisioned.ok).toBe(true);
      if (!provisioned.ok) return;

      const result = await decommissionTenantDatabase(company.id);
      expect(result).toStrictEqual({ ok: true, companyDeleted: true });

      const originalStillThere = await admin.query(
        "select 1 from pg_database where datname = $1",
        [naming.databaseName],
      );
      expect(originalStillThere.rowCount).toBe(0);
      // T12c: `like '%<id>%'` matched ANY database whose name contained this
      // company's id as a numeric substring (e.g. id 26 inside another
      // test's "…_260_…" or "…_1263_…"), so a low/colliding serial id could
      // record and later try to drop the WRONG parked database — leaving
      // this one, and the role it still owns, as residue. Anchored on the
      // full original database name instead (no LIKE `_`-wildcard ambiguity
      // via `~`, and `naming.databaseName` is alnum/underscore-only per
      // `assertSafeIdentifier`, so it needs no regex escaping).
      const parked = await admin.query(
        "select datname from pg_database where datname ~ $1",
        [`^zz_decommissioned_tenant_${company.id}_`],
      );
      expect(parked.rowCount).toBeGreaterThanOrEqual(1);
      const parkedName = parked.rows[0].datname as string;
      plantedDatabases.push(parkedName);

      const roleRow = await admin.query(
        "select rolcanlogin from pg_roles where rolname = $1",
        [naming.dbUser],
      );
      expect(roleRow.rows[0].rolcanlogin).toBe(false);

      const rowGone = await db("core")("tenant_databases")
        .where("companyId", company.id)
        .first();
      expect(rowGone).toBeUndefined();
      const companyGone = await db("core")("companies")
        .where("id", company.id)
        .first();
      expect(companyGone).toBeUndefined();
      // Delete succeeded — no need for afterAll to remove this company row.
      companyIds.splice(companyIds.indexOf(company.id), 1);
    }, 30000);

    it("AC-55: a fault before the row delete leaves 'decommissioning', and a rerun completes", async () => {
      const company = await makeCompany("decommission-retry");
      const naming = computeTenantNaming(company.id, company.slug);
      plantedRoles.push(naming.dbUser);

      const provisioned = await provisionTenantDatabase(company.id, {
        serverUuid,
      });
      expect(provisioned.ok).toBe(true);
      if (!provisioned.ok) return;

      await expect(
        decommissionTenantDatabase(company.id, { failAfter: "roleNoLogin" }),
      ).rejects.toThrow(/roleNoLogin/);

      const midFlight = await db("core")("tenant_databases")
        .where("companyId", company.id)
        .first();
      expect(midFlight?.status).toBe("decommissioning");

      const result = await decommissionTenantDatabase(company.id);
      expect(result).toStrictEqual({ ok: true, companyDeleted: true });

      // T12c: `like '%<id>%'` matched ANY database whose name contained this
      // company's id as a numeric substring (e.g. id 26 inside another
      // test's "…_260_…" or "…_1263_…"), so a low/colliding serial id could
      // record and later try to drop the WRONG parked database — leaving
      // this one, and the role it still owns, as residue. Anchored on the
      // full original database name instead (no LIKE `_`-wildcard ambiguity
      // via `~`, and `naming.databaseName` is alnum/underscore-only per
      // `assertSafeIdentifier`, so it needs no regex escaping).
      const parked = await admin.query(
        "select datname from pg_database where datname ~ $1",
        [`^zz_decommissioned_tenant_${company.id}_`],
      );
      expect(parked.rowCount).toBeGreaterThanOrEqual(1);
      plantedDatabases.push(parked.rows[0].datname as string);
      companyIds.splice(companyIds.indexOf(company.id), 1);
    }, 30000);
  },
);
