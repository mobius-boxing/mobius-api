/**
 * AC-25, AC-26, AC-27 — the tenant migration set applied to a scratch tenant
 * database, and compared with the local core database it was generated from.
 *
 * `npm run db:bootstrap -- --scratch-tenant --run <run>` creates
 * `zz_jest_tenant_<run>` and applies `migrations/tenant/` exactly as a
 * developer would; `afterAll` drops it and asserts `pg_database` is back to its
 * starting count (L-013). Creating it needs CREATEDB: when `SQL_USER` lacks it,
 * set `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` to a role that has it. Without
 * one the suite FAILS with the reason; it is never skipped. The AC-27 case
 * regenerates the baseline and needs the `pg_dump` of the server's major
 * version (`PG_DUMP`, else `pg_dump` on PATH); without it that case fails.
 *
 * Guarded to localhost like every real-DB suite. Run it from
 * `repos/mobius-api`:
 *
 *   PG_DUMP=/opt/homebrew/opt/postgresql@16/bin/pg_dump \
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=traffic_user SQL_PASSWORD=… \
 *   SQL_DATABASE=traffic_production SQL_ADMIN_USER=<CREATEDB role> SQL_ADMIN_PASSWORD=… \
 *   npx jest src/__tests__/schema/tenant-baseline.schema.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { spawnSync } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Client, type QueryResultRow } from "pg";
import { knex as createKnex } from "knex";
import { tablesOf } from "../../database/ownership";
import { crossPlaneRefs } from "../../database/cross-plane-refs";
import {
  AUDIT_EXCLUDED,
  AUDIT_NO_UUID,
  AUDIT_PARENT,
  AUDIT_REDACT,
  auditedTablesOf,
} from "../../database/audit-coverage";
import {
  AUDIT_TRIGGER_NAME,
  auditPartitionSpecs,
} from "../../database/audit-triggers";
import {
  TENANT_BASELINE_FILE,
  coreMigrationConnection,
  migrationsDirectory,
} from "../../database/migration-sets";
import {
  baselinePath,
  renderTenantBaseline,
} from "../../scripts/generate-tenant-baseline";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const RUN = randomBytes(4).toString("hex");
const SCRATCH = `zz_jest_tenant_${RUN}`;
const API_ROOT = path.join(__dirname, "..", "..", "..");
const KNEX_TABLES = ["knex_migrations", "knex_migrations_lock"];

/** `pg_trigger.tgtype` bits: ROW 1, BEFORE 2, INSERT 4, DELETE 8, UPDATE 16. */
const AFTER_ROW_INSERT_DELETE_UPDATE = 1 | 4 | 8 | 16;
const BEFORE_ROW_DELETE_UPDATE = 1 | 2 | 8 | 16;

const sorted = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => a.localeCompare(b));

type ColumnRow = {
  table: string;
  column: string;
  dataType: string;
  udt: string;
  length: number | null;
  nullable: string;
  default: string | null;
};

const TABLES_SQL = `SELECT c.relname AS name
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`;

const COLUMNS_SQL = `SELECT table_name AS "table", column_name AS "column",
        data_type AS "dataType", udt_name AS udt,
        character_maximum_length AS length, is_nullable AS nullable,
        column_default AS "default"
   FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY($1)`;

const FOREIGN_KEYS_SQL = `SELECT src.relname AS "table", con.conname AS "constraint",
        ref.relname AS target
   FROM pg_constraint con
   JOIN pg_class src ON src.oid = con.conrelid
   JOIN pg_class ref ON ref.oid = con.confrelid
  WHERE con.contype = 'f' AND NOT src.relispartition`;

const LEADING_INDEX_SQL = `SELECT c.relname AS "table", a.attname AS "column"
   FROM pg_index i
   JOIN pg_class c ON c.oid = i.indrelid
   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
  WHERE i.indpred IS NULL AND c.relname = ANY($1)`;

describeIfLocalDb(
  "tenant migration set on a scratch tenant database (AC-25…AC-27)",
  () => {
    const server = {
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
    };
    const app = {
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
    };
    const adminUser = process.env.SQL_ADMIN_USER ?? process.env.SQL_USER;
    const adminPassword = process.env.SQL_ADMIN_USER
      ? process.env.SQL_ADMIN_PASSWORD
      : process.env.SQL_PASSWORD;

    let admin: Client | undefined;
    let tenant: Client | undefined;
    let local: Client | undefined;
    let databasesBefore = 0;
    let bootstrapStdout = "";

    const rows = async <T extends QueryResultRow>(
      client: Client | undefined,
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> => {
      if (!client) throw new Error("database client is not open");
      return (await client.query<T>(sql, params)).rows;
    };

    const databaseCount = async (): Promise<number> => {
      const [row] = await rows<{ count: string }>(
        admin,
        `SELECT count(*) FROM pg_database`,
      );
      return Number(row?.count);
    };

    const renderColumns = (columns: ColumnRow[]): string[] =>
      sorted(
        columns.map(
          (c) =>
            `${c.table}.${c.column} ${c.dataType} ${c.udt}(${c.length ?? ""}) ` +
            `nullable=${c.nullable} default=${c.default ?? ""}`,
        ),
      );

    beforeAll(async () => {
      admin = new Client({
        ...server,
        user: adminUser,
        password: adminPassword,
        database: process.env.SQL_DATABASE,
      });
      await admin.connect();
      const [privilege] = await rows<{ allowed: boolean }>(
        admin,
        `SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname = current_user`,
      );
      if (!privilege?.allowed) {
        throw new Error(
          `role ${String(adminUser)} lacks CREATEDB — set ` +
            `SQL_ADMIN_USER/SQL_ADMIN_PASSWORD to a role that has it`,
        );
      }
      databasesBefore = await databaseCount();

      const bootstrap = spawnSync(
        "npm",
        [
          "run",
          "--silent",
          "db:bootstrap",
          "--",
          "--scratch-tenant",
          "--run",
          RUN,
        ],
        { cwd: API_ROOT, env: process.env, encoding: "utf8", timeout: 170000 },
      );
      bootstrapStdout = bootstrap.stdout ?? "";
      if (bootstrap.status !== 0) {
        throw new Error(
          `db:bootstrap --scratch-tenant exited ${String(bootstrap.status)}:\n` +
            `${bootstrap.stdout}\n${bootstrap.stderr}`,
        );
      }

      tenant = new Client({ ...server, ...app, database: SCRATCH });
      await tenant.connect();
      local = new Client({
        ...server,
        ...app,
        database: process.env.SQL_DATABASE,
      });
      await local.connect();
    }, 180000);

    afterAll(async () => {
      await tenant?.end();
      await local?.end();
      if (!admin) return;
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
        if (databasesBefore > 0) {
          expect(await databaseCount()).toBe(databasesBefore);
        }
      } finally {
        await admin.end();
      }
    }, 60000);

    it("was created by db:bootstrap and holds exactly the tenant set's migrations", async () => {
      const lines = bootstrapStdout.trim().split("\n");
      expect(lines[lines.length - 1]).toBe(SCRATCH);
      const files = sorted(
        fs
          .readdirSync(migrationsDirectory("tenant"))
          .filter((f) => f.endsWith(".ts")),
      );
      expect(files[0]).toBe(TENANT_BASELINE_FILE);
      const applied = await rows<{ name: string }>(
        tenant,
        `SELECT name FROM knex_migrations ORDER BY id`,
      );
      expect(applied.map((row) => row.name)).toEqual(files);
    });

    it("holds exactly the tenant plane's tables plus knex's own (AC-25)", async () => {
      const live = await rows<{ name: string }>(tenant, TABLES_SQL);
      expect(sorted(live.map((row) => row.name))).toEqual(
        sorted([...tablesOf("tenant"), ...KNEX_TABLES]),
      );
    });

    it("has no foreign key leaving the tenant plane and keeps every one inside it (AC-25, I-5)", async () => {
      const tenantTables = new Set(tablesOf("tenant"));
      const render = (fk: {
        table: string;
        constraint: string;
        target: string;
      }): string => `${fk.table}.${fk.constraint} -> ${fk.target}`;
      const scratchKeys = await rows<{
        table: string;
        constraint: string;
        target: string;
      }>(tenant, FOREIGN_KEYS_SQL);
      const localKeys = await rows<{
        table: string;
        constraint: string;
        target: string;
      }>(local, FOREIGN_KEYS_SQL);
      expect(
        scratchKeys.filter((fk) => !tenantTables.has(fk.target)).map(render),
      ).toEqual([]);
      const intraTenant = localKeys.filter(
        (fk) => tenantTables.has(fk.table) && tenantTables.has(fk.target),
      );
      expect(intraTenant.length).toBeGreaterThan(0);
      expect(sorted(scratchKeys.map(render))).toEqual(
        sorted(intraTenant.map(render)),
      );
    });

    it("keeps each former cross-plane column's type and nullability, and indexes it (AC-25, I-5)", async () => {
      const localKnex = createKnex({
        client: "pg",
        connection: { ...server, ...app, database: process.env.SQL_DATABASE },
        pool: { min: 0, max: 1 },
      });
      const refs = await crossPlaneRefs(localKnex).finally(() =>
        localKnex.destroy(),
      );
      expect(refs.length).toBeGreaterThan(0);
      const tables = sorted(new Set(refs.map((ref) => ref.table)));
      const byColumn = (columns: ColumnRow[]): Map<string, string> =>
        new Map(
          columns.map((c) => [
            `${c.table}.${c.column}`,
            `${c.udt}(${c.length ?? ""}) nullable=${c.nullable}`,
          ]),
        );
      const before = byColumn(
        await rows<ColumnRow>(local, COLUMNS_SQL, [tables]),
      );
      const after = byColumn(
        await rows<ColumnRow>(tenant, COLUMNS_SQL, [tables]),
      );
      const leading = new Set(
        (
          await rows<{ table: string; column: string }>(
            tenant,
            LEADING_INDEX_SQL,
            [tables],
          )
        ).map((row) => `${row.table}.${row.column}`),
      );
      const report = refs.map((ref) => {
        const column = `${ref.table}.${ref.column}`;
        return {
          column,
          before: before.get(column),
          after: after.get(column),
          indexed: leading.has(column),
        };
      });
      expect(report.filter((entry) => entry.before === undefined)).toEqual([]);
      expect(report).toEqual(
        report.map((entry) => ({
          ...entry,
          after: entry.before,
          indexed: true,
        })),
      );
    });

    it("defines every tenant table's columns exactly as the local database does (AC-25)", async () => {
      const tables = tablesOf("tenant");
      const scratch = renderColumns(
        await rows<ColumnRow>(tenant, COLUMNS_SQL, [tables]),
      );
      expect(scratch.length).toBeGreaterThan(tables.length);
      expect(scratch).toEqual(
        renderColumns(await rows<ColumnRow>(local, COLUMNS_SQL, [tables])),
      );
    });

    it("attaches audit_row_change exactly per AUDIT_REDACT and AUDIT_PARENT (AC-26)", async () => {
      const triggers = await rows<{
        table: string;
        type: number;
        args: Buffer;
      }>(
        tenant,
        `SELECT c.relname AS "table", t.tgtype AS type, t.tgargs AS args
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = $1 AND NOT t.tgisinternal AND t.tgparentid = 0`,
        [AUDIT_TRIGGER_NAME],
      );
      const actual = Object.fromEntries(
        triggers.map((trigger) => [
          trigger.table,
          {
            type: trigger.type,
            args: trigger.args.toString("utf8").split("\0").slice(0, -1),
          },
        ]),
      );
      const expected = Object.fromEntries(
        auditedTablesOf("tenant").map((table) => {
          const parent = AUDIT_PARENT[table];
          return [
            table,
            {
              type: AFTER_ROW_INSERT_DELETE_UPDATE,
              args: [
                (AUDIT_REDACT[table] ?? []).join(","),
                parent?.parent ?? "",
                parent?.fk ?? "",
                parent?.grand ?? "",
                parent?.grandFk ?? "",
              ],
            },
          ];
        }),
      );
      expect(Object.keys(expected).length).toBeGreaterThan(0);
      expect(actual).toEqual(expected);
    });

    it("protects the ledger and partitions it from this month onward (AC-26)", async () => {
      const protect = await rows<{ table: string; type: number }>(
        tenant,
        `SELECT c.relname AS "table", t.tgtype AS type
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = 'audit_logs_protect' AND t.tgparentid = 0`,
      );
      expect(protect).toEqual([
        { table: "audit_logs", type: BEFORE_ROW_DELETE_UPDATE },
      ]);
      const partitions = await rows<{ name: string }>(
        tenant,
        `SELECT c.relname AS name
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'audit_logs' AND c.relkind = 'r'`,
      );
      expect(sorted(partitions.map((row) => row.name))).toEqual(
        sorted([
          ...auditPartitionSpecs(new Date()).map((spec) => spec.name),
          "audit_logs_default",
        ]),
      );
    });

    it("records a tenant write in the tenant ledger and refuses to delete it (AC-26)", async () => {
      await rows(tenant, "BEGIN");
      try {
        const [color] = await rows<{ uuid: string }>(
          tenant,
          `INSERT INTO colors ("companyId", name) VALUES ($1, $2) RETURNING uuid`,
          [1, `zz_jest_${RUN}`],
        );
        const ledger = await rows<{ operation: string; companyId: number }>(
          tenant,
          `SELECT operation, "companyId" FROM audit_logs
          WHERE "entityName" = 'colors' AND "entityUuid" = $1`,
          [color?.uuid],
        );
        expect(ledger).toEqual([{ operation: "Alta", companyId: 1 }]);
        await rows(tenant, "SAVEPOINT protect");
        await expect(
          rows(tenant, `DELETE FROM audit_logs WHERE "entityUuid" = $1`, [
            color?.uuid,
          ]),
        ).rejects.toMatchObject({ code: "P0001" });
        await rows(tenant, "ROLLBACK TO SAVEPOINT protect");
      } finally {
        await rows(tenant, "ROLLBACK");
      }
    });

    it("satisfies the audit-coverage live-schema assertions on the tenant plane (AC-26)", async () => {
      const tenantTables = new Set(tablesOf("tenant"));
      const live = (await rows<{ name: string }>(tenant, TABLES_SQL)).map(
        (row) => row.name,
      );
      const audited = new Set(auditedTablesOf("tenant"));
      expect(
        live.filter(
          (table) => !audited.has(table) && !AUDIT_EXCLUDED.has(table),
        ),
      ).toEqual([]);

      const columns = new Set(
        (await rows<ColumnRow>(tenant, COLUMNS_SQL, [live])).map(
          (c) => `${c.table}.${c.column}`,
        ),
      );
      const broken: string[] = [];
      for (const [child, entry] of Object.entries(AUDIT_PARENT)) {
        if (!tenantTables.has(child)) continue;
        if (!live.includes(entry.parent)) broken.push(`table ${entry.parent}`);
        if (!columns.has(`${child}.${entry.fk}`))
          broken.push(`column ${child}.${entry.fk}`);
        if (entry.grand !== undefined && !live.includes(entry.grand))
          broken.push(`table ${entry.grand}`);
        if (
          entry.grandFk !== undefined &&
          !columns.has(`${entry.parent}.${entry.grandFk}`)
        ) {
          broken.push(`column ${entry.parent}.${entry.grandFk}`);
        }
      }
      for (const [table, redacted] of Object.entries(AUDIT_REDACT)) {
        if (!tenantTables.has(table)) continue;
        for (const column of redacted) {
          if (!columns.has(`${table}.${column}`))
            broken.push(`column ${table}.${column}`);
        }
      }
      expect(broken).toEqual([]);

      const uuidLess = live.filter(
        (table) => tenantTables.has(table) && !columns.has(`${table}.uuid`),
      );
      expect(sorted(uuidLess)).toEqual(
        sorted([...AUDIT_NO_UUID].filter((table) => tenantTables.has(table))),
      );
    });

    it("regenerates the committed baseline byte-for-byte from the local database (AC-27)", async () => {
      const source = coreMigrationConnection();
      const knex = createKnex({
        client: "pg",
        connection: source,
        pool: { min: 0, max: 1 },
      });
      try {
        const rendered = await renderTenantBaseline(
          knex,
          source,
          process.env.PG_DUMP ?? "pg_dump",
        );
        expect(rendered).toEqual(fs.readFileSync(baselinePath(), "utf8"));
      } finally {
        await knex.destroy();
      }
    }, 60000);
  },
);
