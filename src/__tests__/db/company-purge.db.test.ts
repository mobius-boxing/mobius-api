/**
 * `purgeCompany` against a REAL Postgres — db-per-company T0, finding F-1.
 *
 * The node-files tables carry `companyId` with no foreign key to `companies`,
 * so the cascade never reaches them and only the explicit deletes remove them.
 * Proven here:
 *
 *   1. a purged company leaves 0 rows in all six `nf_*` tables and 0 ledger
 *      rows, while a kept company's node-files chain and ledger are untouched;
 *   2. `NODE_FILES_PURGE_ORDER` deletes every child before its parent for every
 *      foreign key `pg_constraint` records between those tables, and lists
 *      every `nf_*` table;
 *   3. `EXPLICITLY_PURGED_TABLES` is exactly the set of company tables no
 *      `ON DELETE CASCADE` reaches — a new unkeyed table turns this red.
 *
 * Run from `repos/mobius-api` against a scratch copy, in band with the P suites
 * (all of them compare every public table's count):
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=mobius_t0_rehearsal \
 *   npx jest --runInBand src/__tests__/db/company-purge.db.test.ts
 *
 * L-013: teardown deletes every fixture explicitly under the maintenance door —
 * never through `purgeCompany`, the code under test — and runs every delete
 * before asserting every public table's count equals the start.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../../database/registry";
import { CompanyDAO } from "../../dao/company/company.dao";
import {
  EXPLICITLY_PURGED_TABLES,
  NODE_FILES_PURGE_ORDER,
  purgeCompany,
} from "../../services/company-purge.service";
import {
  discoverScopedTables,
  findTablesNotPurged,
} from "../../services/purge-snapshot.service";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = Date.now().toString(36);

/**
 * Teardown's own leaf-first order. Deliberately not `NODE_FILES_PURGE_ORDER`:
 * a mutation of that order is exactly what this suite must survive without
 * leaving rows behind.
 */
const TEARDOWN_NODE_FILES_ORDER = [
  "nf_node_runs",
  "nf_runs",
  "nf_documents",
  "nf_workflow_credentials",
  "nf_credentials",
  "nf_workflows",
];

type Company = { id: number; uuid: string };
type Row = Record<string, unknown>;

const rows = async <T = Row>(
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<T[]> =>
  ((await db("core").raw(sql, bindings)) as { rows: T[] }).rows;

const countOf = async (
  sql: string,
  bindings: readonly Knex.RawBinding[] = [],
): Promise<number> => (await rows<{ n: number }>(sql, bindings))[0]?.n ?? 0;

const countAllTables = async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const tables = await rows<{ t: string }>(
    `select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  for (const { t } of tables) {
    counts[t] = await countOf(`select count(*)::int as n from ??`, [t]);
  }
  return counts;
};

const inMaintenance = (
  sql: string,
  bindings: readonly Knex.RawBinding[],
): Promise<void> =>
  db("core").transaction(async (trx) => {
    await trx.raw("select set_config('mobius.audit_maintenance', 'on', true)");
    await trx.raw("select set_config('mobius.audit_skip', 'on', true)");
    await trx.raw(sql, bindings);
  });

/** Runs every step even after one fails, and returns every failure. */
const runAllSteps = async (
  steps: [string, () => Promise<unknown>][],
): Promise<string[]> => {
  const failures: string[] = [];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(`${label}: ${String(error)}`);
    }
  }
  return failures;
};

describeIfLocalDb(
  "purgeCompany against real Postgres — node-files rows (F-1)",
  () => {
    let startCounts: Record<string, number> = {};
    let purged: Company | undefined;
    let kept: Company | undefined;
    const fixtureUuids: string[] = [];

    const newUuid = (): string => {
      const uuid = randomUUID();
      fixtureUuids.push(uuid);
      return uuid;
    };

    const createCompany = async (slug: string): Promise<Company> => {
      await new CompanyDAO().create({ name: slug, slug });
      const [company] = await rows<Company>(
        `select id, uuid::text as uuid from companies where slug = ?`,
        [slug],
      );
      if (!company) throw new Error(`${slug} was not created`);
      return company;
    };

    /** One row in every node-files table, chained the way the module writes them. */
    const seedNodeFiles = async (companyId: number): Promise<void> => {
      const insert = async (sql: string, bindings: Knex.RawBinding[]) =>
        (await rows<{ id: number }>(`${sql} returning id`, bindings))[0]?.id;
      const credentialId = await insert(
        `insert into nf_credentials (uuid, "companyId", name, type, "secretCiphertext", "secretIv", "secretTag")
       values (?, ?, ?, 'header', 'x', 'x', 'x')`,
        [newUuid(), companyId, `zz-jest-nf-cred-${RUN}`],
      );
      const workflowId = await insert(
        `insert into nf_workflows (uuid, "companyId", name) values (?, ?, ?)`,
        [newUuid(), companyId, `zz-jest-nf-wf-${RUN}`],
      );
      await insert(
        `insert into nf_workflow_credentials (uuid, "workflowId", "credentialId", "companyId") values (?, ?, ?, ?)`,
        [newUuid(), workflowId ?? null, credentialId ?? null, companyId],
      );
      const documentId = await insert(
        `insert into nf_documents (uuid, "workflowId", "companyId", "storageKey", "originalName", "contentType")
       values (?, ?, ?, 'zz-jest/key', 'zz-jest.pdf', 'application/pdf')`,
        [newUuid(), workflowId ?? null, companyId],
      );
      const runId = await insert(
        `insert into nf_runs (uuid, "workflowId", "documentId", "companyId") values (?, ?, ?, ?)`,
        [newUuid(), workflowId ?? null, documentId ?? null, companyId],
      );
      await insert(
        `insert into nf_node_runs (uuid, "runId", "companyId", "nodeId", "nodeType", status)
       values (?, ?, ?, 'n1', 'extract', 'done')`,
        [newUuid(), runId ?? null, companyId],
      );
    };

    const nodeFilesCounts = async (
      companyId: number,
    ): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {};
      for (const table of NODE_FILES_PURGE_ORDER) {
        counts[table] = await countOf(
          `select count(*)::int as n from ?? where "companyId" = ?`,
          [table, companyId],
        );
      }
      return counts;
    };

    const ledgerCount = (companyId: number): Promise<number> =>
      countOf(
        `select count(*)::int as n from audit_logs where "companyId" = ?`,
        [companyId],
      );

    const eachNodeFilesTable = (n: number): Record<string, number> =>
      Object.fromEntries(NODE_FILES_PURGE_ORDER.map((t) => [t, n]));

    beforeAll(async () => {
      await connectAll();
      startCounts = await countAllTables();
      purged = await createCompany(`zz-jest-nf-purged-${RUN}`);
      kept = await createCompany(`zz-jest-nf-kept-${RUN}`);
      await seedNodeFiles(purged.id);
      await seedNodeFiles(kept.id);
    });

    afterAll(async () => {
      const companyIds = [purged?.id, kept?.id].filter(
        (id): id is number => id !== undefined,
      );
      try {
        const failures = await runAllSteps([
          ...TEARDOWN_NODE_FILES_ORDER.map(
            (table): [string, () => Promise<unknown>] => [
              table,
              () =>
                inMaintenance(`delete from ?? where "companyId" = any(?)`, [
                  table,
                  companyIds,
                ]),
            ],
          ),
          [
            "companies",
            () =>
              inMaintenance(`delete from companies where id = any(?)`, [
                companyIds,
              ]),
          ],
          [
            "audit_logs",
            () =>
              inMaintenance(
                `delete from audit_logs where "companyId" = any(?) or "entityUuid" = any(?)`,
                [companyIds, fixtureUuids],
              ),
          ],
        ]);
        expect(failures).toEqual([]);
        expect(await countAllTables()).toEqual(startCounts);
      } finally {
        await disconnectAll();
      }
    });

    it("lists every nf_* table, each child before its parent for every foreign key between them", async () => {
      const nfTables = await rows<{ t: string }>(
        `select table_name as t from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like 'nf\\_%'
        order by 1`,
      );
      expect(nfTables.map((r) => r.t)).toEqual(
        [...NODE_FILES_PURGE_ORDER].sort(),
      );

      const fks = await rows<{ child: string; parent: string; rule: string }>(
        `select child.relname as child, parent.relname as parent, c.confdeltype::text as rule
         from pg_constraint c
         join pg_class child on child.oid = c.conrelid
         join pg_class parent on parent.oid = c.confrelid
        where c.contype = 'f' and child.relname = any(?) and parent.relname = any(?)
        order by 1, 2`,
        [[...NODE_FILES_PURGE_ORDER], [...NODE_FILES_PURGE_ORDER]],
      );
      const order: readonly string[] = NODE_FILES_PURGE_ORDER;
      expect(fks.length).toBeGreaterThan(0);
      const parentFirst = fks.filter(
        (fk) => order.indexOf(fk.child) >= order.indexOf(fk.parent),
      );
      expect(parentFirst).toEqual([]);
    });

    it("names exactly the company tables no ON DELETE CASCADE reaches as explicitly purged", async () => {
      const tables = await discoverScopedTables(db("core"));
      const uncovered = await findTablesNotPurged(db("core"), tables, []);
      expect(uncovered.map((c) => c.split(".")[0]).sort()).toEqual(
        [...EXPLICITLY_PURGED_TABLES].sort(),
      );
      expect(
        await findTablesNotPurged(db("core"), tables, EXPLICITLY_PURGED_TABLES),
      ).toEqual([]);
    });

    it("leaves 0 node-files and 0 ledger rows of the purged company, and touches nothing of the kept one", async () => {
      if (!purged || !kept) throw new Error("fixtures were not created");
      expect(await nodeFilesCounts(purged.id)).toEqual(eachNodeFilesTable(1));
      expect(await nodeFilesCounts(kept.id)).toEqual(eachNodeFilesTable(1));
      expect(await ledgerCount(purged.id)).toBeGreaterThan(0);
      const keptLedger = await ledgerCount(kept.id);

      const result = await purgeCompany(purged.id);

      expect(result.companyDeleted).toBe(true);
      expect(await nodeFilesCounts(purged.id)).toEqual(eachNodeFilesTable(0));
      expect(await ledgerCount(purged.id)).toBe(0);
      expect(
        await countOf(`select count(*)::int as n from companies where id = ?`, [
          purged.id,
        ]),
      ).toBe(0);
      expect(await nodeFilesCounts(kept.id)).toEqual(eachNodeFilesTable(1));
      expect(await ledgerCount(kept.id)).toBe(keptLedger);
    });
  },
);
