/**
 * db-per-company T12a — against REAL Postgres, with two separate dedicated
 * `tenant_*` databases plus the shared target:
 *
 *   - scope A: `purgeUser` across all of them (T9/D-8, T4/D-124 follow-up,
 *     required before the first company move, C2).
 *   - scope C: `db-check-integrity --company <uuid>` (real flag; runbook
 *     alignment), reusing the same two dedicated tenants.
 *
 * Needs a scratch CORE database built by `npm run db:bootstrap` (T6's
 * registry tables must exist) and an admin role with CREATEDB + CREATEROLE
 * for the two scratch `tenant_*` databases this suite provisions:
 *
 *   SQL_HOST=localhost SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch core db> SQL_ADMIN_USER=… SQL_ADMIN_PASSWORD=… \
 *   npx jest --runInBand src/__tests__/db/purge-user-fleet.db.test.ts
 *
 * Every planted database/role this suite provisions is dropped in
 * `afterAll` (L-013); core-side rows (companies, users, tenant_databases,
 * db_servers, the shared target's own files/countdown_* rows, audit_logs)
 * are deleted explicitly the same way `tenant-provisioning.db.test.ts` does.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import {
  computeTenantNaming,
  provisionTenantDatabase,
} from "../../services/tenant-provisioning.service";
import {
  closeDedicatedTenant,
  listDedicatedTenants,
  openDedicatedTenant,
  resolveDedicatedTenant,
} from "../../database/dedicated-tenants";
import {
  UserPurgeRefusedError,
  purgeUser,
} from "../../services/company-purge.service";
import { runDbCheckIntegrity } from "../../scripts/db-check-integrity";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const hasAdmin =
  process.env.SQL_ADMIN_USER !== undefined &&
  process.env.SQL_ADMIN_PASSWORD !== undefined;
const describeIfReady = isLocalDb && hasAdmin ? describe : describe.skip;

const RUN = Date.now().toString(36);
const mark = (suffix: string): string => `zz-jest-t12a-${RUN}-${suffix}`;

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
  "purgeUser across the shared target and dedicated tenant databases (T12a)",
  () => {
    let admin: Client;
    let serverId = 0;
    let serverUuid = "";
    const companyIds: number[] = [];
    const userIds: number[] = [];
    const plantedDatabases: string[] = [];
    const plantedRoles: string[] = [];

    const makeCompany = async (
      suffix: string,
    ): Promise<{ id: number; uuid: string; slug: string }> => {
      const slug = mark(suffix);
      const row = await one<{ id: number; uuid: string }>(
        `insert into companies (name, slug) values (?, ?) returning id, uuid`,
        [`Zz Jest T12a ${suffix}`, slug],
      );
      companyIds.push(row.id);
      return { ...row, slug };
    };

    const makeSuperAdmin = async (
      suffix: string,
    ): Promise<{ id: number; uuid: string }> => {
      const row = await one<{ id: number; uuid: string }>(
        `insert into users (email, password, "firstName", "lastName", "companyId", role)
         values (?, 'x', 'zz', 'jest', null, 'superAdmin') returning id, uuid::text as uuid`,
        [`zz-jest-t12a-${suffix}-${RUN}@example.test`],
      );
      userIds.push(row.id);
      return row;
    };

    const provisionDedicated = async (company: {
      id: number;
      slug: string;
    }): Promise<{ row: unknown; server: unknown; tenant: Knex }> => {
      const naming = computeTenantNaming(company.id, company.slug);
      plantedDatabases.push(naming.databaseName);
      plantedRoles.push(naming.dbUser);
      const result = await provisionTenantDatabase(company.id, { serverUuid });
      if (!result.ok) {
        throw new Error(`provisioning failed: ${result.reason}`);
      }
      const target = await resolveDedicatedTenant(company.id);
      if (!target) throw new Error("resolveDedicatedTenant found nothing");
      const tenant = await openDedicatedTenant(target);
      return { row: result.row, server: target.server, tenant };
    };

    const rowsOn = async <T = Row>(
      knex: Knex,
      sql: string,
      bindings: readonly Knex.RawBinding[] = [],
    ): Promise<T[]> => ((await knex.raw(sql, bindings)) as { rows: T[] }).rows;
    const oneOn = async <T = Row>(
      knex: Knex,
      sql: string,
      bindings: readonly Knex.RawBinding[] = [],
    ): Promise<T> => {
      const [row] = await rowsOn<T>(knex, sql, bindings);
      if (!row) throw new Error(`no row: ${sql}`);
      return row;
    };

    const filesRow = async (
      knex: Knex,
      companyId: number,
      uploadedBy: number | null,
    ): Promise<string> => {
      const inserted = await oneOn<{ uuid: string }>(
        knex,
        `insert into files ("companyId", "originalName", "storageKey", "uploadedBy")
         values (?, 'zz-jest.pdf', ?, ?) returning uuid::text as uuid`,
        [companyId, `zz-jest/t12a/${RUN}/${randomUUID()}`, uploadedBy],
      );
      return inserted.uuid;
    };

    const fileUploadedBy = async (
      knex: Knex,
      uuid: string,
    ): Promise<number | null> => {
      const result = await rowsOn<{ v: number | null }>(
        knex,
        `select "uploadedBy" as v from files where uuid = ?`,
        [uuid],
      );
      return result[0]?.v ?? null;
    };

    const groupMember = async (
      knex: Knex,
      companyId: number,
      userId: number,
    ): Promise<string> => {
      const group = await oneOn<{ id: number }>(
        knex,
        `insert into countdown_groups ("companyId", name) values (?, ?) returning id`,
        [companyId, mark("group")],
      );
      const member = await oneOn<{ uuid: string }>(
        knex,
        `insert into countdown_group_members ("groupId", "userId") values (?, ?) returning uuid::text as uuid`,
        [group.id, userId],
      );
      return member.uuid;
    };

    const exists = async (
      knex: Knex,
      table: string,
      uuid: string,
    ): Promise<boolean> => {
      const result = (await knex.raw(`select 1 from ?? where uuid = ?`, [
        table,
        uuid,
      ])) as { rows: unknown[] };
      return result.rows.length > 0;
    };

    const userExists = async (userId: number): Promise<boolean> =>
      (await rows(`select 1 from users where id = ?`, [userId])).length > 0;

    let compShared: { id: number; uuid: string; slug: string };
    let compA: { id: number; uuid: string; slug: string };
    let compB: { id: number; uuid: string; slug: string };
    let tenantA: Knex;
    let tenantB: Knex;

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

      compShared = await makeCompany("shared");
      compA = await makeCompany("dedicated-a");
      compB = await makeCompany("dedicated-b");

      const a = await provisionDedicated(compA);
      const b = await provisionDedicated(compB);
      tenantA = a.tenant;
      tenantB = b.tenant;
    }, 120000);

    afterAll(async () => {
      await tenantA?.destroy();
      await tenantB?.destroy();
      for (const name of plantedDatabases) {
        await admin
          .query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
          .catch(() => admin.query(`DROP DATABASE IF EXISTS "${name}"`));
      }
      for (const name of plantedRoles) {
        await admin.query(`DROP ROLE IF EXISTS "${name}"`);
      }
      await db("core").transaction(async (trx) => {
        await trx.raw(
          "select set_config('mobius.audit_maintenance', 'on', true)",
        );
        await trx.raw(`delete from files where "companyId" = ?`, [
          compShared.id,
        ]);
        await trx.raw(
          `delete from countdown_group_members where "groupId" in (select id from countdown_groups where "companyId" = ?)`,
          [compShared.id],
        );
        await trx.raw(`delete from countdown_groups where "companyId" = ?`, [
          compShared.id,
        ]);
        await trx.raw(
          `delete from tenant_migration_runs where "tenantDatabaseId" in (select id from tenant_databases where "companyId" = any(?))`,
          [companyIds],
        );
        await trx.raw(
          `delete from tenant_databases where "companyId" = any(?)`,
          [companyIds],
        );
        await trx.raw(`delete from users where id = any(?)`, [userIds]);
        await trx.raw(`delete from companies where id = any(?)`, [companyIds]);
        await trx.raw(`delete from db_servers where id = ?`, [serverId]);
        await trx.raw(
          `delete from audit_logs where "companyId" = any(?)
              or ("entityName" = 'db_servers' and "entityId" = ?)
              or ("entityName" = 'companies' and "entityId" = any(?))
              or ("entityName" = 'users' and "entityId" = any(?))`,
          [companyIds, serverId, companyIds, userIds],
        );
      });
      await admin.end();
      await disconnectAll();
    }, 60000);

    it("purges a superAdmin's references on the shared target and every dedicated tenant database, user deleted last", async () => {
      const superAdmin = await makeSuperAdmin("cross-tenant");
      const sharedFile = await filesRow(
        db("core"),
        compShared.id,
        superAdmin.id,
      );
      const tenantAFile = await filesRow(tenantA, compA.id, superAdmin.id);
      const tenantAMember = await groupMember(tenantA, compA.id, superAdmin.id);
      const tenantBFile = await filesRow(tenantB, compB.id, superAdmin.id);

      const result = await purgeUser(superAdmin.id);

      expect(result.userDeleted).toBe(true);
      expect(await fileUploadedBy(db("core"), sharedFile)).toBeNull();
      expect(await fileUploadedBy(tenantA, tenantAFile)).toBeNull();
      expect(
        await exists(tenantA, "countdown_group_members", tenantAMember),
      ).toBe(false);
      expect(await fileUploadedBy(tenantB, tenantBFile)).toBeNull();
      expect(await userExists(superAdmin.id)).toBe(false);
    });

    it("a RESTRICT reference in one dedicated tenant refuses the whole purge before any write anywhere", async () => {
      const superAdmin = await makeSuperAdmin("refused");
      const sharedFile = await filesRow(
        db("core"),
        compShared.id,
        superAdmin.id,
      );
      const tenantAFile = await filesRow(tenantA, compA.id, superAdmin.id);
      const blocker = await oneOn<{ uuid: string }>(
        tenantB,
        `insert into countdown_documents ("companyId", title, "dueDate", "uploadedBy")
         values (?, ?, current_date, ?) returning uuid::text as uuid`,
        [compB.id, mark("blocker"), superAdmin.id],
      );
      const blockerUuid = blocker.uuid;

      const purge = purgeUser(superAdmin.id);
      await expect(purge).rejects.toBeInstanceOf(UserPurgeRefusedError);
      await expect(purge).rejects.toMatchObject({
        code: "23503",
        message: expect.stringContaining("countdown_documents.uploadedBy"),
      });

      // Every database — the shared target, the tenant with no blocker, and
      // the tenant that blocked — is unchanged: the preflight covers all of
      // them before any write anywhere.
      expect(await userExists(superAdmin.id)).toBe(true);
      expect(await fileUploadedBy(db("core"), sharedFile)).toBe(superAdmin.id);
      expect(await fileUploadedBy(tenantA, tenantAFile)).toBe(superAdmin.id);
      expect(await exists(tenantB, "countdown_documents", blockerUuid)).toBe(
        true,
      );
    });

    describe("db-check-integrity --company (T12a scope C)", () => {
      const integrityDeps = () => ({
        core: () => db("core"),
        tenant: () => db("core"),
        now: () => new Date(),
        listDedicatedTenants,
        resolveCompany: (uuid: string) =>
          uuid === compA.uuid
            ? resolveDedicatedTenant(compA.id)
            : uuid === compB.uuid
              ? resolveDedicatedTenant(compB.id)
              : Promise.resolve(null),
        openTenant: openDedicatedTenant,
        closeTenant: closeDedicatedTenant,
      });

      it("exits 0 (CLEAN) for a real dedicated tenant named by uuid", async () => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runDbCheckIntegrity(["--company", compA.uuid], {
          ...integrityDeps(),
          out: (line) => out.push(line),
          err: (line) => err.push(line),
        });
        expect(err).toEqual([]);
        expect(code).toBe(0);
        expect(out[0]).toContain("CLEAN");
        expect(out[0]).toContain(compA.uuid);
      });

      it("exits 2 for a company with no live dedicated tenant database", async () => {
        const err: string[] = [];
        const code = await runDbCheckIntegrity(["--company", compShared.uuid], {
          ...integrityDeps(),
          out: () => undefined,
          err: (line) => err.push(line),
        });
        expect(code).toBe(2);
        expect(err.join("\n")).toContain("no live dedicated tenant database");
      });

      it("exits 2 on a malformed uuid, before resolving anything", async () => {
        const err: string[] = [];
        const code = await runDbCheckIntegrity(["--company", "not-a-uuid"], {
          ...integrityDeps(),
          resolveCompany: () => {
            throw new Error("must not be called");
          },
          out: () => undefined,
          err: (line) => err.push(line),
        });
        expect(code).toBe(2);
        expect(err.join("\n")).toContain("--company needs a uuid");
      });

      it("exits 2 when --company is combined with --pre-c1 or --fleet-coverage", async () => {
        const err1: string[] = [];
        expect(
          await runDbCheckIntegrity(
            ["--company", compA.uuid, "--fleet-coverage"],
            {
              ...integrityDeps(),
              out: () => undefined,
              err: (l) => err1.push(l),
            },
          ),
        ).toBe(2);

        const err2: string[] = [];
        expect(
          await runDbCheckIntegrity(
            ["--company", compA.uuid, "--pre-c1", "--snapshot", "x.json"],
            {
              ...integrityDeps(),
              out: () => undefined,
              err: (l) => err2.push(l),
            },
          ),
        ).toBe(2);
      });

      it("finds an orphan uploadedBy planted in tenant B when named by uuid", async () => {
        const MISSING_USER_ID = 2147483000;
        const blocker = await oneOn<{ uuid: string }>(
          tenantB,
          `insert into countdown_documents ("companyId", title, "dueDate", "uploadedBy")
           values (?, ?, current_date, ?) returning uuid::text as uuid`,
          [compB.id, mark("integrity-blocker"), MISSING_USER_ID],
        );
        try {
          const err: string[] = [];
          const code = await runDbCheckIntegrity(["--company", compB.uuid], {
            ...integrityDeps(),
            out: () => undefined,
            err: (line) => err.push(line),
          });
          expect(code).toBe(1);
          expect(err.join("\n")).toContain("countdown_documents.uploadedBy");
        } finally {
          await tenantB.raw(`delete from countdown_documents where uuid = ?`, [
            blocker.uuid,
          ]);
        }
      });
    });
  },
);
