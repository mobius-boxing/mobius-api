/**
 * Fleet migration against REAL Postgres (db-per-company T9, model D-18,
 * brief AC-54): three dedicated scratch tenants, one made unable to apply a
 * new migration, prove attempt-all/report/non-zero-exit and that a rerun
 * retries only the failed one.
 *
 * Needs the same scratch core database + admin role as
 * `tenant-provisioning.db.test.ts`:
 *
 *   SQL_HOST=localhost SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch core db> SQL_ADMIN_USER=… SQL_ADMIN_PASSWORD=… \
 *   npx jest --runInBand src/__tests__/db/migrate-all.db.test.ts
 *
 * Writes one throwaway migration file into the REAL `migrations/tenant/`
 * directory for the duration of this suite (removed in `afterAll`) — the
 * only way to give the fleet step genuine pending work without touching the
 * checked-in baseline. Run this suite alone (L-013 sibling rule): a
 * concurrent suite reading `migrations/tenant/` would see it too.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { migrationsDirectory } from "../../database/migration-sets";
import {
  computeTenantNaming,
  provisionTenantDatabase,
} from "../../services/tenant-provisioning.service";
import { realMigrateFleet } from "../../scripts/migrate-all";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const hasAdmin =
  process.env.SQL_ADMIN_USER !== undefined &&
  process.env.SQL_ADMIN_PASSWORD !== undefined;
const describeIfReady = isLocalDb && hasAdmin ? describe : describe.skip;

const RUN = Date.now().toString(36);
const mark = (suffix: string): string => `zz-jest-t9-fleet-${RUN}-${suffix}`;

const MARKER_MIGRATION = path.join(
  migrationsDirectory("tenant"),
  "00000000000001_zz_jest_t9_fleet_marker.ts",
);
const MARKER_MIGRATION_SOURCE = `
import type { Knex } from "knex";
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("zz_jest_t9_fleet_marker", (t) => {
    t.increments("id");
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("zz_jest_t9_fleet_marker");
}
`;

describeIfReady(
  "migrate-all fleet step against real Postgres (T9, AC-54)",
  () => {
    let admin: Client;
    let serverId = 0;
    const companyIds: number[] = [];
    const plantedDatabases: string[] = [];
    const plantedRoles: string[] = [];

    const dropDatabaseIfExists = async (name: string): Promise<void> => {
      await admin
        .query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
        .catch(() => admin.query(`DROP DATABASE IF EXISTS "${name}"`));
    };
    const dropRoleIfExists = async (name: string): Promise<void> => {
      await admin.query(`DROP ROLE IF EXISTS "${name}"`);
    };

    const makeCompany = async (
      suffix: string,
    ): Promise<{ id: number; uuid: string; slug: string }> => {
      const slug = mark(suffix);
      const [row] = await db("core")("companies")
        .insert({ name: `Zz Jest T9 Fleet ${suffix}`, slug })
        .returning(["id", "uuid"]);
      companyIds.push(row.id as number);
      return { id: row.id as number, uuid: row.uuid as string, slug };
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
        .returning("id");
      serverId = server.id as number;
    }, 30000);

    afterAll(async () => {
      fs.rmSync(MARKER_MIGRATION, { force: true });
      for (const name of plantedDatabases) await dropDatabaseIfExists(name);
      for (const name of plantedRoles) await dropRoleIfExists(name);
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
        await trx.raw(`delete from db_servers where id = ?`, [serverId]);
        await trx.raw(
          `delete from audit_logs where ("entityName" = 'tenant_databases' and "companyId" = any(?))
            or ("entityName" = 'db_servers' and "entityId" = ?)
            or ("entityName" = 'companies' and "entityId" = any(?))`,
          [companyIds, serverId, companyIds],
        );
      });
      await admin.end();
      await disconnectAll();
    }, 30000);

    it("AC-54: attempts every tenant, reports a broken one, exits non-zero-equivalent, and a rerun retries only it", async () => {
      const good1 = await makeCompany("good-1");
      const good2 = await makeCompany("good-2");
      const broken = await makeCompany("broken");

      const [serverRow] = await db("core")("db_servers").where("id", serverId);

      for (const company of [good1, good2, broken]) {
        const naming = computeTenantNaming(company.id, company.slug);
        plantedDatabases.push(naming.databaseName);
        plantedRoles.push(naming.dbUser);
        const result = await provisionTenantDatabase(company.id, {
          serverUuid: serverRow.uuid,
        });
        expect(result.ok).toBe(true);
      }

      // Now give the fleet real pending work: a migration none of the three
      // has applied yet.
      fs.writeFileSync(MARKER_MIGRATION, MARKER_MIGRATION_SOURCE);

      // A fresh database's `public` schema is owned by its own dbUser (PG15+
      // transfers it automatically), so a bare REVOKE on that role does
      // nothing — owners bypass the ACL system entirely. Reassigning the
      // schema to the admin role first makes the REVOKE actually bite.
      const brokenNaming = computeTenantNaming(broken.id, broken.slug);
      const brokenAdmin = new Client({
        host: process.env.SQL_HOST,
        port: Number(process.env.SQL_PORT) || 5432,
        user: process.env.SQL_ADMIN_USER,
        password: process.env.SQL_ADMIN_PASSWORD,
        database: brokenNaming.databaseName,
      });
      await brokenAdmin.connect();
      try {
        await brokenAdmin.query(
          `ALTER SCHEMA public OWNER TO "${process.env.SQL_ADMIN_USER}"`,
        );
        await brokenAdmin.query(
          `REVOKE CREATE ON SCHEMA public FROM "${brokenNaming.dbUser}"`,
        );
      } finally {
        await brokenAdmin.end();
      }

      const first = await realMigrateFleet({});
      expect(first.attempted).toBe(3);
      expect(first.failed).toStrictEqual([brokenNaming.databaseName]);

      const rows = await db("core")("tenant_databases")
        .whereIn("companyId", [good1.id, good2.id, broken.id])
        .select("id", "companyId", "status", "migrationState", "schemaVersion");
      const byCompany = new Map(rows.map((r) => [r.companyId, r]));
      expect(byCompany.get(good1.id)?.migrationState).toBe("current");
      expect(byCompany.get(good1.id)?.schemaVersion).toBe(
        "00000000000001_zz_jest_t9_fleet_marker.ts",
      );
      expect(byCompany.get(good2.id)?.migrationState).toBe("current");
      expect(byCompany.get(broken.id)?.migrationState).toBe("failed");
      // Fleet migration failures never touch tenant_databases.status (I-8):
      // a broken migration is not a status transition.
      expect(byCompany.get(broken.id)?.status).toBe("active");

      const runs = await db("core")("tenant_migration_runs").whereIn(
        "tenantDatabaseId",
        rows.map((r) => r.id),
      );
      expect(runs.some((r) => r.status === "succeeded")).toBe(true);
      expect(runs.some((r) => r.status === "failed")).toBe(true);

      // Rerun: the two already-current tenants are skipped; only the broken
      // one is attempted again.
      const second = await realMigrateFleet({});
      expect(second.attempted).toBe(1);
      expect(second.skippedCurrent).toBe(2);
      expect(second.failed).toStrictEqual([brokenNaming.databaseName]);

      // Fix it, then confirm a scoped --company run migrates just that one.
      const fixClient = new Client({
        host: process.env.SQL_HOST,
        port: Number(process.env.SQL_PORT) || 5432,
        user: process.env.SQL_ADMIN_USER,
        password: process.env.SQL_ADMIN_PASSWORD,
        database: brokenNaming.databaseName,
      });
      await fixClient.connect();
      try {
        await fixClient.query(
          `GRANT CREATE ON SCHEMA public TO "${brokenNaming.dbUser}"`,
        );
      } finally {
        await fixClient.end();
      }
      const scoped = await realMigrateFleet({ companyUuid: broken.uuid });
      expect(scoped.attempted).toBe(1);
      expect(scoped.failed).toStrictEqual([]);

      const finalRow = await db("core")("tenant_databases")
        .where("companyId", broken.id)
        .first();
      expect(finalRow.migrationState).toBe("current");
    }, 60000);
  },
);
