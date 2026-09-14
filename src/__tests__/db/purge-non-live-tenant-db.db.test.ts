/**
 * db-per-company T12a/D-orch-1 — `purgeCompany` against REAL Postgres: a
 * company whose only `tenant_databases` row never reached live (`failed` /
 * `provisioning`) can be deleted outright; a company with a live dedicated
 * row (`active`) still refuses (I-14 unchanged — decommission first).
 *
 * No CREATEDB/CREATEROLE needed: this suite never provisions a real
 * dedicated database, only rows in the registry tables (`db_servers`,
 * `tenant_databases`) that satisfy the FK the RESTRICT rule enforces.
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch core db> \
 *   npx jest --runInBand src/__tests__/db/purge-non-live-tenant-db.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Knex } from "knex";
import {
  connectAll,
  disconnectAll,
  db,
  rawCoreInstance,
  withTenantTarget,
} from "../../database/registry";
import { CompanyDAO } from "../../dao/company/company.dao";
import { purgeCompany } from "../../services/company-purge.service";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);
const mark = (suffix: string): string =>
  `zz-jest-t12a-nonlive-${RUN}-${suffix}`;

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

const runAsCoreTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  withTenantTarget({ physicalKey: "core", instance: rawCoreInstance() }, fn);

describeIfLocalDb(
  "purgeCompany — non-live tenant_databases rows are cleared, live ones still refuse (T12a/D-orch-1)",
  () => {
    let serverId = 0;
    const companyIds: number[] = [];
    const tenantDatabaseIds: number[] = [];

    const createCompany = async (label: string): Promise<number> => {
      const slug = mark(label);
      await new CompanyDAO().create({ name: slug, slug });
      const company = await one<{ id: number }>(
        `select id from companies where slug = ?`,
        [slug],
      );
      companyIds.push(company.id);
      return company.id;
    };

    /** `databaseName`/`dbUser` must match `^[a-z][a-z0-9_]{0,62}$` — no hyphens. */
    const identifier = (suffix: string): string =>
      `zz_jest_t12a_nonlive_${RUN}_${suffix}`.replace(/-/g, "_");

    const createTenantDatabaseRow = async (
      companyId: number,
      status: "failed" | "provisioning" | "active",
    ): Promise<number> => {
      const row = await one<{ id: number }>(
        `insert into tenant_databases
           (uuid, "companyId", "serverId", "databaseName", "dbUser",
            "credentialRef", status, "migrationState")
         values (gen_random_uuid(), ?, ?, ?, ?, 'env:SQL_PASSWORD', ?, 'current')
         returning id`,
        [
          companyId,
          serverId,
          identifier(`db_${companyId}_${status}`),
          identifier(`user_${companyId}_${status}`),
          status,
        ],
      );
      tenantDatabaseIds.push(row.id);
      return row.id;
    };

    beforeAll(async () => {
      await connectAll();
      const server = await one<{ id: number }>(
        `insert into db_servers (name, kind, host, port, "sslMode", "connectionBudget", "isDefaultPlacement", status)
         values (?, 'external', 'localhost', 5432, 'disable', 5, false, 'active')
         returning id`,
        [mark("server")],
      );
      serverId = server.id;
    });

    afterAll(async () => {
      await db("core").transaction(async (trx) => {
        await trx.raw(
          "select set_config('mobius.audit_maintenance', 'on', true)",
        );
        await trx.raw(
          `delete from tenant_migration_runs where "tenantDatabaseId" = any(?)`,
          [tenantDatabaseIds],
        );
        await trx.raw(`delete from tenant_databases where id = any(?)`, [
          tenantDatabaseIds,
        ]);
        await trx.raw(`delete from companies where id = any(?)`, [companyIds]);
        await trx.raw(`delete from db_servers where id = ?`, [serverId]);
        await trx.raw(
          `delete from audit_logs where "companyId" = any(?)
              or ("entityName" = 'tenant_databases' and "companyId" = any(?))
              or ("entityName" = 'db_servers' and "entityId" = ?)
              or ("entityName" = 'companies' and "entityId" = any(?))`,
          [companyIds, companyIds, serverId, companyIds],
        );
      });
      await disconnectAll();
    });

    it("deletes a company whose only tenant_databases row is 'failed', and removes that row", () =>
      runAsCoreTenant(async () => {
        const companyId = await createCompany("failed-only");
        const tenantDatabaseId = await createTenantDatabaseRow(
          companyId,
          "failed",
        );

        const result = await purgeCompany(companyId);

        expect(result.companyDeleted).toBe(true);
        expect(
          (await rows(`select 1 from companies where id = ?`, [companyId]))
            .length,
        ).toBe(0);
        expect(
          (
            await rows(`select 1 from tenant_databases where id = ?`, [
              tenantDatabaseId,
            ])
          ).length,
        ).toBe(0);
      }));

    it("deletes a company whose only tenant_databases row is 'provisioning', and removes that row", () =>
      runAsCoreTenant(async () => {
        const companyId = await createCompany("provisioning-only");
        const tenantDatabaseId = await createTenantDatabaseRow(
          companyId,
          "provisioning",
        );

        const result = await purgeCompany(companyId);

        expect(result.companyDeleted).toBe(true);
        expect(
          (
            await rows(`select 1 from tenant_databases where id = ?`, [
              tenantDatabaseId,
            ])
          ).length,
        ).toBe(0);
      }));

    it("still refuses a company with a live (active) dedicated tenant_databases row — decommission first (I-14)", () =>
      runAsCoreTenant(async () => {
        const companyId = await createCompany("active-live");
        await createTenantDatabaseRow(companyId, "active");

        await expect(purgeCompany(companyId)).rejects.toMatchObject({
          code: "23503",
        });

        expect(
          (await rows(`select 1 from companies where id = ?`, [companyId]))
            .length,
        ).toBe(1);
      }));
  },
);
