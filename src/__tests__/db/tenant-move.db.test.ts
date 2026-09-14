/**
 * `tenant:move` against REAL Postgres (db-per-company model C2, brief T11
 * AC-67…69). Moves a seeded company off the shared/legacy target (C1) into a
 * freshly provisioned scratch tenant database, under that company's own
 * suspension.
 *
 * Needs a scratch CORE database (T6's registry tables) and an admin role with
 * CREATEDB + CREATEROLE for the scratch target server this suite creates —
 * same preconditions as `tenant-provisioning.db.test.ts`:
 *
 *   SQL_HOST=localhost SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch core db> SQL_ADMIN_USER=… SQL_ADMIN_PASSWORD=… \
 *   npx jest --runInBand src/__tests__/db/tenant-move.db.test.ts
 *
 * Creates REAL `tenant_<id>_*` databases/roles and drops every one it
 * creates in `afterAll` (L-013). Never drops the scratch core database's own
 * `db_servers` "default placement" row.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID } from "crypto";
import { Client } from "pg";
import { knex as createKnex, type Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { connectionFor, connectionForTenant } from "../../database/env";
import { resolveCredential } from "../../database/credential-resolver";
import { RbacService } from "../../services/rbac.service";
import { CompanyDAO } from "../../dao/company/company.dao";
import { TenantDatabaseDAO } from "../../dao/tenant-database/tenant-database.dao";
import {
  computeTenantNaming,
  move,
  type MoveHooks,
} from "../../services/tenant-provisioning.service";
import {
  acquireTenant,
  resetTenantPoolsForTest,
} from "../../database/tenant-pools";
import {
  checkDedicatedTenantPin,
  checkDedicatedTenantRows,
} from "../../scripts/db-check-integrity";
import type { ITenantDatabase } from "../../interfaces/tenant/tenant.interfaces";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const hasAdmin =
  process.env.SQL_ADMIN_USER !== undefined &&
  process.env.SQL_ADMIN_PASSWORD !== undefined;
const describeIfReady = isLocalDb && hasAdmin ? describe : describe.skip;

const RUN = Date.now().toString(36);
const mark = (suffix: string): string => `zz-jest-t11-${RUN}-${suffix}`;

type Row = Record<string, unknown>;
const rows = async <T = Row>(
  sql: string,
  bindings: readonly unknown[] = [],
): Promise<T[]> =>
  ((await db("core").raw(sql, bindings as never[])) as { rows: T[] }).rows;
const one = async <T = Row>(
  sql: string,
  bindings: readonly unknown[] = [],
): Promise<T> => {
  const [row] = await rows<T>(sql, bindings);
  if (!row) throw new Error(`no row: ${sql}`);
  return row;
};

describeIfReady("tenant:move against real Postgres (T11)", () => {
  let admin: Client;
  let targetServerId = 0;
  let targetServerUuid = "";
  const companyIds: number[] = [];
  const plantedDatabases: string[] = [];
  const plantedRoles: string[] = [];

  const dropDatabaseIfExists = async (name: string): Promise<void> => {
    await admin
      .query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      .catch(async () => {
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      });
  };
  const dropRoleIfExists = async (name: string): Promise<void> => {
    await admin.query(`DROP ROLE IF EXISTS "${name}"`);
  };

  const makeCompany = async (
    suffix: string,
  ): Promise<{ id: number; uuid: string; slug: string }> => {
    const slug = mark(suffix);
    await new CompanyDAO().create({ name: `Zz Jest T11 ${suffix}`, slug });
    const row = await one<{ id: number; uuid: string }>(
      `select id, uuid::text as uuid from companies where slug = ?`,
      [slug],
    );
    companyIds.push(row.id);
    await RbacService.seedCompanyRbac(db("core"), row.id);
    return { ...row, slug };
  };

  /** Registers `companyId` on the shared target, exactly what `tenant:register-shared` writes (C1). */
  const registerOnShared = async (companyId: number): Promise<void> => {
    const core = connectionFor("core");
    await db("core")("tenant_databases").insert({
      uuid: randomUUID(),
      companyId,
      serverId: (
        await one<{ id: number }>(
          `select id from db_servers where "isDefaultPlacement" = true`,
        )
      ).id,
      databaseName: core.database,
      dbUser: core.user,
      credentialRef: "env:SQL_PASSWORD",
      status: "active",
    });
  };

  const openTargetKnex = async (row: ITenantDatabase): Promise<Knex> => {
    const server = await one<{
      id: number;
      host: string | null;
      port: number | null;
      sslMode: string;
      adminUser: string | null;
      adminCredentialRef: string | null;
    }>(`select * from db_servers where id = ?`, [row.serverId]);
    const password = await resolveCredential(
      row.credentialRef,
      row.credentialCiphertext,
    );
    return createKnex({
      client: "pg",
      connection: connectionForTenant(
        row,
        {
          id: server.id,
          host: server.host,
          port: server.port,
          sslMode: server.sslMode as never,
        } as never,
        password,
      ),
      pool: { min: 0, max: 2 },
    });
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
    targetServerId = server.id as number;
    targetServerUuid = server.uuid as string;
  });

  afterAll(async () => {
    resetTenantPoolsForTest();
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
      await trx.raw(`delete from tenant_databases where "companyId" = any(?)`, [
        companyIds,
      ]);
      await trx.raw(`delete from companies where id = any(?)`, [companyIds]);
      await trx.raw(`delete from db_servers where id = ?`, [targetServerId]);
      await trx.raw(
        `delete from audit_logs where "companyId" = any(?) or ("entityName" = 'db_servers' and "entityId" = ?)`,
        [companyIds, targetServerId],
      );
    });
    await admin.end();
    await disconnectAll();
  }, 30000);

  it("AC-67: --dry-run prints predicates and counts, and changes nothing", async () => {
    const a = await makeCompany("dry-run");
    await registerOnShared(a.id);
    await one(
      `insert into customers (uuid, "companyId", name) values (gen_random_uuid(), ?, ?) returning id`,
      [a.id, "Zz Jest Dry Run Customer"],
    );

    const before = {
      tenantDatabases: await rows(`select * from tenant_databases order by id`),
      pgDatabase: (
        await admin.query("select datname from pg_database order by 1")
      ).rows,
      pgRoles: (await admin.query("select rolname from pg_roles order by 1"))
        .rows,
    };

    const result = await move(a.uuid, {
      serverUuid: targetServerUuid,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    const customersStep = result.steps.find((s) => s.table === "customers");
    expect(customersStep?.rows).toBe(1);
    expect(customersStep?.predicate).toContain("companyId");
    // FK-topological order: a table is never listed before a table it depends on.
    const indexOf = (t: string): number =>
      result.steps.findIndex((s) => s.table === t);
    expect(indexOf("corrugations")).toBeLessThan(indexOf("corrugation_layers"));

    const after = {
      tenantDatabases: await rows(`select * from tenant_databases order by id`),
      pgDatabase: (
        await admin.query("select datname from pg_database order by 1")
      ).rows,
      pgRoles: (await admin.query("select rolname from pg_roles order by 1"))
        .rows,
    };
    expect(after).toStrictEqual(before);
  }, 30000);

  it("AC-68: a real move copies rows, flips the registry, and leaves the target servable", async () => {
    const a = await makeCompany("move-a");
    const b = await makeCompany("move-b");
    await registerOnShared(a.id);
    await registerOnShared(b.id);

    await one(
      `insert into customers (uuid, "companyId", name) values (gen_random_uuid(), ?, ?) returning id`,
      [a.id, "Zz Jest Move Customer 1"],
    );
    await one(
      `insert into customers (uuid, "companyId", name) values (gen_random_uuid(), ?, ?) returning id`,
      [a.id, "Zz Jest Move Customer 2"],
    );
    const corrugation = await one<{ id: number }>(
      `insert into corrugations (uuid, "companyId", code) values (gen_random_uuid(), ?, ?) returning id`,
      [a.id, mark("corr")],
    );
    await one(
      `insert into corrugation_layers (uuid, "corrugationId", position) values (gen_random_uuid(), ?, 1) returning id`,
      [corrugation.id],
    );
    const logoFile = await one<{ uuid: string }>(
      `insert into files (uuid, "companyId", "originalName", "storageKey") values (gen_random_uuid(), ?, ?, ?) returning uuid::text as uuid`,
      [a.id, "logo.png", mark("logo-key")],
    );
    await one(
      `insert into files (uuid, "companyId", "originalName", "storageKey") values (gen_random_uuid(), ?, ?, ?) returning id`,
      [a.id, "product-photo.png", mark("file-key")],
    );
    await db("core")("companies")
      .where("id", a.id)
      .update({ branding: JSON.stringify({ logoFileUuid: logoFile.uuid }) });

    const countOf = async (table: string): Promise<number> =>
      Number(
        (
          await one<{ n: string }>(
            `select count(*)::text as n from ?? where "companyId" = ?`,
            [table, a.id],
          )
        ).n,
      );
    const sourceCounts = {
      customers: await countOf("customers"),
      files: await countOf("files"),
      auditLogs: await countOf("audit_logs"),
    };
    expect(sourceCounts.customers).toBe(2);
    expect(sourceCounts.files).toBe(2);

    // Interrupted right after the target is provisioned (still suspended,
    // nothing copied yet) — proves the second company keeps being served,
    // and that a rerun resumes from the existing "provisioning" row.
    await expect(
      move(a.uuid, { serverUuid: targetServerUuid }, {
        failAfter: "provision",
      } as MoveHooks),
    ).rejects.toThrow(/provision/);

    const midFlightSource = await new TenantDatabaseDAO().getById(
      (
        await one<{ id: number }>(
          `select id from tenant_databases where "companyId" = ? and status = 'suspended'`,
          [a.id],
        )
      ).id,
    );
    expect(midFlightSource?.status).toBe("suspended");

    const naming = computeTenantNaming(a.id, a.slug);
    plantedDatabases.push(naming.databaseName);
    plantedRoles.push(naming.dbUser);

    const bystander = await one<{ id: number }>(
      `select id from tenant_databases where "companyId" = ? and status = 'active'`,
      [b.id],
    );
    const bystanderResolution = await acquireTenant(b.id);
    expect(bystanderResolution.kind).toBe("ok");
    void bystander;

    // The interrupted attempt above already wrote its own audit_logs rows
    // (suspending the source, creating the target row) — re-read the live
    // count right before the real move, rather than the pre-move baseline.
    const auditLogsAtCopyTime = await countOf("audit_logs");

    const result = await move(a.uuid, { serverUuid: targetServerUuid });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(false);

    const customersStep = result.steps.find((s) => s.table === "customers");
    expect(customersStep?.rows).toBe(sourceCounts.customers);
    const filesStep = result.steps.find((s) => s.table === "files");
    expect(filesStep?.rows).toBe(sourceCounts.files - 1); // logo excluded
    const auditStep = result.steps.find((s) => s.table === "audit_logs");
    expect(auditStep?.rows).toBe(auditLogsAtCopyTime);

    const sourceRow = await one<{ id: number; status: string }>(
      `select id, status from tenant_databases where "companyId" = ? and "databaseName" = ?`,
      [a.id, connectionFor("core").database],
    );
    expect(sourceRow.status).toBe("retired");
    const targetRowRaw = await one<Row>(
      `select * from tenant_databases where "companyId" = ? and "databaseName" = ?`,
      [a.id, naming.databaseName],
    );
    expect(targetRowRaw.status).toBe("active");
    const targetRow = await new TenantDatabaseDAO().getById(
      targetRowRaw.id as number,
    );
    if (!targetRow) throw new Error("target row vanished");

    const targetKnex = await openTargetKnex(targetRow);
    try {
      const targetCustomers = Number(
        (await targetKnex("customers").count())[0]?.count,
      );
      expect(targetCustomers).toBe(sourceCounts.customers);
      const targetFiles = Number((await targetKnex("files").count())[0]?.count);
      expect(targetFiles).toBe(sourceCounts.files - 1);
      const targetAudit = Number(
        (await targetKnex("audit_logs").count())[0]?.count,
      );
      expect(targetAudit).toBe(auditLogsAtCopyTime); // no synthetic Alta from the copy

      // Sequences advanced: a post-move insert with no explicit id succeeds.
      const inserted = await targetKnex("customers")
        .insert({
          uuid: randomUUID(),
          companyId: a.id,
          name: "Zz Jest Post-Move Insert",
        })
        .returning("id");
      expect((inserted[0] as { id: number }).id).toBeGreaterThan(0);

      const pinFinding = await checkDedicatedTenantPin(targetKnex, targetRow);
      expect(pinFinding).toBeNull();
      const rowFindings = await checkDedicatedTenantRows(targetKnex, targetRow);
      expect(rowFindings).toEqual([]);
    } finally {
      await targetKnex.destroy();
    }
  }, 60000);

  it("AC-69: a count mismatch aborts, resumes the source, and leaves the target failed with no flip", async () => {
    const a = await makeCompany("mismatch");
    await registerOnShared(a.id);
    await one(
      `insert into customers (uuid, "companyId", name) values (gen_random_uuid(), ?, ?) returning id`,
      [a.id, "Zz Jest Mismatch Customer"],
    );
    const naming = computeTenantNaming(a.id, a.slug);
    plantedDatabases.push(naming.databaseName);
    plantedRoles.push(naming.dbUser);

    const result = await move(a.uuid, { serverUuid: targetServerUuid }, {
      corruptBeforeVerify: async (target) => {
        // Under audit_skip, so this injected corruption does not also write a
        // "Baja" row that would make audit_logs itself mismatch first.
        await target.transaction(async (trx) => {
          await trx.raw("select set_config('mobius.audit_skip', 'on', true)");
          await trx("customers").del();
        });
      },
    } as MoveHooks);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("customers");

    const sourceRow = await one<{ status: string }>(
      `select status from tenant_databases where "companyId" = ? and "databaseName" = ?`,
      [a.id, connectionFor("core").database],
    );
    expect(sourceRow.status).toBe("active");
    const targetRow = await one<{ status: string }>(
      `select status from tenant_databases where "companyId" = ? and "databaseName" = ?`,
      [a.id, naming.databaseName],
    );
    expect(targetRow.status).toBe("failed");
  }, 30000);

  it("AC-69: killing the process after the copy and rerunning completes without duplicate rows", async () => {
    const a = await makeCompany("resume-after-copy");
    await registerOnShared(a.id);
    await one(
      `insert into customers (uuid, "companyId", name) values (gen_random_uuid(), ?, ?) returning id`,
      [a.id, "Zz Jest Resume Customer"],
    );
    const naming = computeTenantNaming(a.id, a.slug);
    plantedDatabases.push(naming.databaseName);
    plantedRoles.push(naming.dbUser);

    await expect(
      move(a.uuid, { serverUuid: targetServerUuid }, {
        failAfter: "copy",
      } as MoveHooks),
    ).rejects.toThrow(/copy/);

    const result = await move(a.uuid, { serverUuid: targetServerUuid });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const customersStep = result.steps.find((s) => s.table === "customers");
    expect(customersStep?.rows).toBe(1);

    const targetRow = await one<Row>(
      `select * from tenant_databases where "companyId" = ? and "databaseName" = ?`,
      [a.id, naming.databaseName],
    );
    const targetKnex = await openTargetKnex(
      (await new TenantDatabaseDAO().getById(targetRow.id as number))!,
    );
    try {
      const count = Number((await targetKnex("customers").count())[0]?.count);
      expect(count).toBe(1); // no duplicate from the interrupted first attempt
    } finally {
      await targetKnex.destroy();
    }
  }, 60000);

  it("AC-69: NODE_ENV=production refuses without --confirm matching --company", async () => {
    const a = await makeCompany("prod-guard");
    await registerOnShared(a.id);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const result = await move(a.uuid, { serverUuid: targetServerUuid });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("D-53");

      const wrongConfirm = await move(a.uuid, {
        serverUuid: targetServerUuid,
        confirmCompanyUuid: randomUUID(),
      });
      expect(wrongConfirm.ok).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
    }

    const row = await one<{ status: string }>(
      `select status from tenant_databases where "companyId" = ?`,
      [a.id],
    );
    expect(row.status).toBe("active"); // never touched
  }, 30000);
});
