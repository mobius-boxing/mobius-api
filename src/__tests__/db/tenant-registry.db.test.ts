/**
 * AC-31 (I-1), AC-32 (I-8 DB half), AC-33 (I-14), AC-35, AC-36 — the tenant
 * registry against a REAL Postgres.
 *
 * Run from `repos/mobius-api` against a scratch core database built by
 * `npm run db:bootstrap` (T6's migrations must have run):
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch> npx jest --runInBand src/__tests__/db/tenant-registry.db.test.ts
 *
 * L-013: every row this suite writes carries the `RUN` marker (company slugs,
 * server/database names); `afterAll` deletes them under the maintenance door
 * and asserts the three registry tables plus `companies` and `audit_logs` are
 * back to their starting counts.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import {
  InvalidTenantDatabaseTransitionError,
  TenantDatabaseDAO,
} from "../../dao/tenant-database/tenant-database.dao";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);

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

const count = async (table: string): Promise<number> =>
  (await one<{ n: string }>(`select count(*)::int as n from ??`, [table]))
    .n as unknown as number;

const inMaintenance = (
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
) =>
  db("core").transaction(async (trx) => {
    await trx.raw("select set_config('mobius.audit_maintenance', 'on', true)");
    await trx.raw(sql, bindings);
  });

describeIfLocalDb("tenant registry (AC-31, AC-32, AC-33, AC-35, AC-36)", () => {
  let startCounts: Record<string, number>;
  let companyId: number;
  let serverId: number;
  /** Every db_servers row this suite creates, for the audit-ledger sweep. */
  const serverIds: number[] = [];

  beforeAll(async () => {
    await connectAll();
    startCounts = {
      companies: await count("companies"),
      db_servers: await count("db_servers"),
      tenant_databases: await count("tenant_databases"),
      tenant_migration_runs: await count("tenant_migration_runs"),
      audit_logs: await count("audit_logs"),
    };

    const company = await one<{ id: number }>(
      `insert into companies (name, slug) values (?, ?) returning id`,
      [`zz-jest-${RUN}`, `zz-jest-${RUN}`],
    );
    companyId = company.id;

    const server = await one<{ id: number }>(
      `insert into db_servers (name, kind, "connectionBudget") values (?, 'external', 5) returning id`,
      [`zz-jest-server-${RUN}`],
    );
    serverId = server.id;
    serverIds.push(serverId);
  });

  afterAll(async () => {
    await inMaintenance(
      `delete from tenant_migration_runs where "tenantDatabaseId" in (select id from tenant_databases where "companyId" = ?)`,
      [companyId],
    );
    await inMaintenance(`delete from tenant_databases where "companyId" = ?`, [
      companyId,
    ]);
    await inMaintenance(`delete from db_servers where id = any(?)`, [
      serverIds,
    ]);
    await inMaintenance(`delete from companies where id = ?`, [companyId]);
    // The trigger fills tenant_databases' own companyId column onto its ledger
    // rows automatically; db_servers carries no companyId, so its rows are
    // swept by the id list this suite tracked instead.
    await inMaintenance(
      `delete from audit_logs where ("entityName" = 'tenant_databases' and "companyId" = ?)
          or ("entityName" = 'db_servers' and "entityId" = any(?))
          or ("entityName" = 'companies' and "entityId" = ?)`,
      [companyId, serverIds, companyId],
    );

    const endCounts = {
      companies: await count("companies"),
      db_servers: await count("db_servers"),
      tenant_databases: await count("tenant_databases"),
      tenant_migration_runs: await count("tenant_migration_runs"),
      audit_logs: await count("audit_logs"),
    };
    expect(endCounts).toEqual(startCounts);
    await disconnectAll();
  });

  const insertTenantDatabase = async (
    overrides: Partial<{
      databaseName: string;
      dbUser: string;
      credentialRef: string;
      credentialCiphertext: Buffer | null;
      status: string;
    }> = {},
  ): Promise<number> => {
    const suffix = overrides.status ?? "active";
    const row = await one<{ id: number }>(
      `insert into tenant_databases
         ("companyId", "serverId", "databaseName", "dbUser", "credentialRef", "credentialCiphertext", status)
       values (?, ?, ?, ?, ?, ?, ?)
       returning id`,
      [
        companyId,
        serverId,
        overrides.databaseName ?? `zz_jest_${RUN}_${suffix}`,
        overrides.dbUser ?? `zz_jest_${RUN}_${suffix}_user`,
        overrides.credentialRef ?? "env:SQL_PASSWORD",
        overrides.credentialCiphertext ?? null,
        overrides.status ?? "active",
      ],
    );
    return row.id;
  };

  describe("I-1 — at most one live row, at most one building row (AC-31)", () => {
    it("allows a live row, then rejects a second live row for the same company", async () => {
      const firstId = await insertTenantDatabase({ status: "active" });
      await expect(
        insertTenantDatabase({
          databaseName: `zz_jest_${RUN}_active2`,
          dbUser: `zz_jest_${RUN}_active2_user`,
          status: "active",
        }),
      ).rejects.toThrow(/tenant_databases_company_live_uidx/);

      // One live row plus one building row succeeds (different partial index).
      const buildingId = await insertTenantDatabase({
        databaseName: `zz_jest_${RUN}_building`,
        dbUser: `zz_jest_${RUN}_building_user`,
        status: "provisioning",
      });
      expect(buildingId).not.toBe(firstId);

      // A second building row is rejected too.
      await expect(
        insertTenantDatabase({
          databaseName: `zz_jest_${RUN}_building2`,
          dbUser: `zz_jest_${RUN}_building2_user`,
          status: "failed",
        }),
      ).rejects.toThrow(/tenant_databases_company_build_uidx/);

      await inMaintenance(`delete from tenant_databases where id in (?, ?)`, [
        firstId,
        buildingId,
      ]);
    });
  });

  describe("I-8 — status transitions only through the model's table (AC-32)", () => {
    it("suspendedAt CHECK rejects a violation (status='suspended' with no suspendedAt)", async () => {
      await expect(
        one(
          `insert into tenant_databases
             ("companyId", "serverId", "databaseName", "dbUser", "credentialRef", status)
           values (?, ?, ?, ?, 'env:SQL_PASSWORD', 'suspended') returning id`,
          [
            companyId,
            serverId,
            `zz_jest_${RUN}_badsuspend`,
            `zz_jest_${RUN}_badsuspend_user`,
          ],
        ),
      ).rejects.toThrow(/tenant_databases_suspended_at_check/);
    });

    it("transition() returns 0 for a stale `from`, and the DAO throws for an off-table pair", async () => {
      const id = await insertTenantDatabase({
        databaseName: `zz_jest_${RUN}_cas`,
        dbUser: `zz_jest_${RUN}_cas_user`,
        status: "active",
      });
      const dao = new TenantDatabaseDAO();

      // Stale `from`: the row is "active", not "provisioning".
      await expect(dao.transition(id, "provisioning", "active")).resolves.toBe(
        0,
      );

      // A pair outside the model's table throws before touching the row.
      await expect(dao.transition(id, "active", "active")).rejects.toThrow(
        InvalidTenantDatabaseTransitionError,
      );

      // The real transition succeeds and clears suspendedAt on the way back out.
      const suspended = await dao.transition(id, "active", "suspended", {
        suspendReason: "jest",
      });
      expect(suspended).toBe(1);
      const afterSuspend = await one<{
        suspendedAt: Date | null;
        status: string;
      }>(`select "suspendedAt", status from tenant_databases where id = ?`, [
        id,
      ]);
      expect(afterSuspend.status).toBe("suspended");
      expect(afterSuspend.suspendedAt).not.toBeNull();

      const resumed = await dao.transition(id, "suspended", "active");
      expect(resumed).toBe(1);
      const afterResume = await one<{ suspendedAt: Date | null }>(
        `select "suspendedAt" from tenant_databases where id = ?`,
        [id],
      );
      expect(afterResume.suspendedAt).toBeNull();

      await inMaintenance(`delete from tenant_databases where id = ?`, [id]);
    });
  });

  describe("I-14 — decommission never cascades from companies (AC-33)", () => {
    it("raises 23503 deleting a company with a registry row", async () => {
      const id = await insertTenantDatabase({
        databaseName: `zz_jest_${RUN}_restrict`,
        dbUser: `zz_jest_${RUN}_restrict_user`,
        status: "active",
      });
      await expect(
        db("core").raw(`delete from companies where id = ?`, [companyId]),
      ).rejects.toMatchObject({ code: "23503" });
      await inMaintenance(`delete from tenant_databases where id = ?`, [id]);
    });
  });

  describe("AC-35 — a registry insert is a redacted central Alta", () => {
    it("writes an Alta with credentialCiphertext absent, never NULL-valued", async () => {
      const ciphertext = Buffer.from("deadbeef", "hex");
      const id = await insertTenantDatabase({
        databaseName: `zz_jest_${RUN}_audited`,
        dbUser: `zz_jest_${RUN}_audited_user`,
        credentialRef: "enc:v1",
        credentialCiphertext: ciphertext,
        status: "provisioning",
      });

      const auditRow = await one<{
        operation: string;
        after: Record<string, unknown>;
      }>(
        `select operation, after from audit_logs
          where "entityName" = 'tenant_databases' and "entityId" = ? order by id desc limit 1`,
        [id],
      );
      expect(auditRow.operation).toBe("Alta");
      expect(
        Object.prototype.hasOwnProperty.call(
          auditRow.after,
          "credentialCiphertext",
        ),
      ).toBe(false);
      expect(auditRow.after.credentialRef).toBe("enc:v1");

      await inMaintenance(`delete from tenant_databases where id = ?`, [id]);
    });

    it("redacts db_servers.adminCredentialCiphertext the same way", async () => {
      const server = await one<{ id: number }>(
        `insert into db_servers (name, kind, "sslMode", "adminUser", "adminCredentialRef", "adminCredentialCiphertext", "connectionBudget")
         values (?, 'rds', 'require', 'admin', 'enc:v1', ?, 10) returning id`,
        [`zz-jest-audited-server-${RUN}`, Buffer.from("cafebabe", "hex")],
      );
      serverIds.push(server.id);
      const auditRow = await one<{ after: Record<string, unknown> }>(
        `select after from audit_logs where "entityName" = 'db_servers' and "entityId" = ? order by id desc limit 1`,
        [server.id],
      );
      expect(
        Object.prototype.hasOwnProperty.call(
          auditRow.after,
          "adminCredentialCiphertext",
        ),
      ).toBe(false);

      await inMaintenance(`delete from db_servers where id = ?`, [server.id]);
    });
  });

  describe("AC-36 — the shared server row", () => {
    it("has exactly one row, kind=shared_container, host/port NULL, budget 30, default placement, no admin", async () => {
      const shared = await rows<{
        id: number;
        kind: string;
        host: string | null;
        port: number | null;
        connectionBudget: number;
        isDefaultPlacement: boolean;
        adminUser: string | null;
      }>(
        `select id, kind, host, port, "connectionBudget", "isDefaultPlacement", "adminUser"
           from db_servers where "isDefaultPlacement" = true`,
      );
      expect(shared).toHaveLength(1);
      expect(shared[0]).toMatchObject({
        kind: "shared_container",
        host: null,
        port: null,
        connectionBudget: 30,
        isDefaultPlacement: true,
        adminUser: null,
      });
    });

    it("rejects a second default-placement server", async () => {
      await expect(
        one(
          `insert into db_servers (name, kind, "connectionBudget", "isDefaultPlacement")
           values (?, 'external', 5, true) returning id`,
          [`zz-jest-second-default-${RUN}`],
        ),
      ).rejects.toThrow(/db_servers_default_uidx/);
    });
  });
});
