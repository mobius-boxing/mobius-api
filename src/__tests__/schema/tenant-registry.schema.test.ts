/**
 * AC-30 — `db_servers`, `tenant_databases` and `tenant_migration_runs`:
 * columns, types, nullability, defaults and every CHECK, against
 * `model.md`'s "New central tables — column detail" exactly.
 *
 * Guarded to `localhost` like every real-DB suite (the `ownership.schema.
 * test.ts:18-20` pattern); read-only (no cleanup needed, L-013). Run it from
 * `repos/mobius-api` against a core database that has run T6's migrations
 * (e.g. a `npm run db:bootstrap` scratch database):
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=<scratch> npx jest src/__tests__/schema/tenant-registry.schema.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client } from "pg";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};

/** column → { type, nullable, default } — default `null` means no DEFAULT clause. */
type ColumnSpec = Record<
  string,
  { type: string; nullable: boolean; default: string | null }
>;

const DB_SERVERS_COLUMNS: ColumnSpec = {
  id: { type: "integer", nullable: false, default: "nextval" },
  uuid: { type: "uuid", nullable: false, default: "gen_random_uuid()" },
  name: { type: "text", nullable: false, default: null },
  kind: { type: "text", nullable: false, default: null },
  host: { type: "text", nullable: true, default: null },
  port: { type: "integer", nullable: true, default: null },
  sslMode: { type: "text", nullable: false, default: "'disable'::text" },
  adminUser: { type: "text", nullable: true, default: null },
  adminCredentialRef: { type: "text", nullable: true, default: null },
  adminCredentialCiphertext: { type: "bytea", nullable: true, default: null },
  connectionBudget: { type: "integer", nullable: false, default: null },
  isDefaultPlacement: { type: "boolean", nullable: false, default: "false" },
  status: { type: "text", nullable: false, default: "'active'::text" },
  createdAt: {
    type: "timestamp with time zone",
    nullable: false,
    default: "CURRENT_TIMESTAMP",
  },
  updatedAt: {
    type: "timestamp with time zone",
    nullable: false,
    default: "CURRENT_TIMESTAMP",
  },
};

const TENANT_DATABASES_COLUMNS: ColumnSpec = {
  id: { type: "integer", nullable: false, default: "nextval" },
  uuid: { type: "uuid", nullable: false, default: "gen_random_uuid()" },
  companyId: { type: "integer", nullable: false, default: null },
  serverId: { type: "integer", nullable: false, default: null },
  databaseName: { type: "text", nullable: false, default: null },
  dbUser: { type: "text", nullable: false, default: null },
  credentialRef: { type: "text", nullable: false, default: null },
  credentialCiphertext: { type: "bytea", nullable: true, default: null },
  poolMax: { type: "integer", nullable: false, default: "3" },
  poolMin: { type: "integer", nullable: false, default: "0" },
  status: { type: "text", nullable: false, default: "'provisioning'::text" },
  schemaVersion: { type: "text", nullable: true, default: null },
  migrationState: { type: "text", nullable: false, default: "'unknown'::text" },
  lastMigrationAt: {
    type: "timestamp with time zone",
    nullable: true,
    default: null,
  },
  lastMigrationError: { type: "text", nullable: true, default: null },
  provisionedAt: {
    type: "timestamp with time zone",
    nullable: true,
    default: null,
  },
  suspendedAt: {
    type: "timestamp with time zone",
    nullable: true,
    default: null,
  },
  suspendReason: { type: "text", nullable: true, default: null },
  createdAt: {
    type: "timestamp with time zone",
    nullable: false,
    default: "CURRENT_TIMESTAMP",
  },
  updatedAt: {
    type: "timestamp with time zone",
    nullable: false,
    default: "CURRENT_TIMESTAMP",
  },
};

const TENANT_MIGRATION_RUNS_COLUMNS: ColumnSpec = {
  id: { type: "bigint", nullable: false, default: "nextval" },
  uuid: { type: "uuid", nullable: false, default: "gen_random_uuid()" },
  tenantDatabaseId: { type: "integer", nullable: false, default: null },
  fromVersion: { type: "text", nullable: true, default: null },
  toVersion: { type: "text", nullable: false, default: null },
  status: { type: "text", nullable: false, default: "'running'::text" },
  triggeredBy: { type: "text", nullable: false, default: null },
  startedAt: {
    type: "timestamp with time zone",
    nullable: false,
    default: "CURRENT_TIMESTAMP",
  },
  finishedAt: {
    type: "timestamp with time zone",
    nullable: true,
    default: null,
  },
  error: { type: "text", nullable: true, default: null },
};

describeIfLocalDb("tenant registry schema (AC-30)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT) || 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DATABASE,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  const readColumns = async (table: string): Promise<ColumnRow[]> => {
    const result = await client.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    );
    return result.rows;
  };

  const assertColumns = async (
    table: string,
    spec: ColumnSpec,
  ): Promise<void> => {
    const live = await readColumns(table);
    expect(live.map((row) => row.column_name).sort()).toEqual(
      Object.keys(spec).sort(),
    );
    for (const row of live) {
      const expected = spec[row.column_name];
      const nullable = row.is_nullable === "YES";
      expect({
        column: row.column_name,
        type: row.data_type,
        nullable,
      }).toEqual({
        column: row.column_name,
        type: expected.type,
        nullable: expected.nullable,
      });
      if (expected.default === null) {
        expect(row.column_default).toBeNull();
      } else if (expected.default === "nextval") {
        expect(row.column_default).toMatch(/^nextval\(/);
      } else {
        expect(row.column_default).toBe(expected.default);
      }
    }
  };

  const readChecks = async (table: string): Promise<string[]> => {
    const result = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'c'`,
      [table],
    );
    return result.rows.map((row) => row.definition);
  };

  it("gives db_servers exactly its columns, types, nullability and defaults", async () => {
    await assertColumns("db_servers", DB_SERVERS_COLUMNS);
  });

  it("gives tenant_databases exactly its columns, types, nullability and defaults", async () => {
    await assertColumns("tenant_databases", TENANT_DATABASES_COLUMNS);
  });

  it("gives tenant_migration_runs exactly its columns, types, nullability and defaults", async () => {
    await assertColumns("tenant_migration_runs", TENANT_MIGRATION_RUNS_COLUMNS);
  });

  it("declares every db_servers CHECK the model lists", async () => {
    const checks = await readChecks("db_servers");
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "kind = ANY (ARRAY['shared_container'::text, 'rds'::text, 'external'::text])",
        ),
        expect.stringContaining(
          "(port IS NULL) OR ((port >= 1) AND (port <= 65535))",
        ),
        expect.stringContaining(
          "\"sslMode\" = ANY (ARRAY['disable'::text, 'require'::text, 'verify-full'::text])",
        ),
        expect.stringContaining(
          '("adminCredentialRef" IS NULL) OR ("adminCredentialRef" ~ \'^(env|enc|secretsmanager):\'::text)',
        ),
        expect.stringContaining(
          '("adminUser" IS NULL) = ("adminCredentialRef" IS NULL)',
        ),
        expect.stringContaining('"adminCredentialCiphertext" IS NOT NULL'),
        expect.stringContaining('"connectionBudget" > 0'),
        expect.stringContaining(
          "status = ANY (ARRAY['active'::text, 'draining'::text, 'retired'::text])",
        ),
      ]),
    );
    expect(checks).toHaveLength(8);
  });

  it("declares every tenant_databases CHECK the model lists", async () => {
    const checks = await readChecks("tenant_databases");
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("\"databaseName\" ~ '^[a-z][a-z0-9_]{0,62}$'"),
        expect.stringContaining("\"dbUser\" ~ '^[a-z][a-z0-9_]{0,62}$'"),
        expect.stringContaining(
          "\"credentialRef\" ~ '^(env|enc|secretsmanager):'",
        ),
        expect.stringContaining(
          '("credentialRef" ~~ \'enc:%\'::text) = ("credentialCiphertext" IS NOT NULL)',
        ),
        expect.stringContaining('("poolMax" >= 1) AND ("poolMax" <= 50)'),
        expect.stringContaining(
          '("poolMin" >= 0) AND ("poolMin" <= "poolMax")',
        ),
        expect.stringContaining(
          "status = ANY (ARRAY['provisioning'::text, 'failed'::text, 'active'::text, 'suspended'::text, 'decommissioning'::text, 'retired'::text])",
        ),
        expect.stringContaining(
          "\"migrationState\" = ANY (ARRAY['unknown'::text, 'current'::text, 'behind'::text, 'running'::text, 'failed'::text])",
        ),
        expect.stringContaining(
          "(status = 'suspended'::text) = (\"suspendedAt\" IS NOT NULL)",
        ),
      ]),
    );
    expect(checks).toHaveLength(9);
  });

  it("declares every tenant_migration_runs CHECK the model lists", async () => {
    const checks = await readChecks("tenant_migration_runs");
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])",
        ),
        expect.stringContaining(
          "(status = 'running'::text) = (\"finishedAt\" IS NULL)",
        ),
      ]),
    );
    expect(checks).toHaveLength(2);
  });

  it("declares the two tenant_databases FKs RESTRICT, and the run log CASCADE (I-14, L-006)", async () => {
    const result = await client.query<{
      table_name: string;
      column_name: string;
      referenced: string;
      delete_rule: string;
    }>(
      `SELECT kcu.table_name, kcu.column_name, ccu.table_name AS referenced, rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu USING (constraint_name)
         JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
        WHERE kcu.table_name IN ('tenant_databases', 'tenant_migration_runs')
        ORDER BY kcu.table_name, kcu.column_name`,
    );
    expect(result.rows).toEqual([
      {
        table_name: "tenant_databases",
        column_name: "companyId",
        referenced: "companies",
        delete_rule: "RESTRICT",
      },
      {
        table_name: "tenant_databases",
        column_name: "serverId",
        referenced: "db_servers",
        delete_rule: "RESTRICT",
      },
      {
        table_name: "tenant_migration_runs",
        column_name: "tenantDatabaseId",
        referenced: "tenant_databases",
        delete_rule: "CASCADE",
      },
    ]);
  });

  it("declares db_servers' default-placement partial unique index (AC-36)", async () => {
    const result = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'db_servers' AND indexname = 'db_servers_default_uidx'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].indexdef).toContain('WHERE "isDefaultPlacement"');
  });

  it("declares tenant_databases' two partial unique indexes (I-1)", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'tenant_databases'
          AND indexname IN ('tenant_databases_company_live_uidx', 'tenant_databases_company_build_uidx')
        ORDER BY indexname`,
    );
    expect(result.rows).toHaveLength(2);
    const live = result.rows.find(
      (row) => row.indexname === "tenant_databases_company_live_uidx",
    );
    const building = result.rows.find(
      (row) => row.indexname === "tenant_databases_company_build_uidx",
    );
    expect(live?.indexdef).toContain(
      "WHERE (status = ANY (ARRAY['active'::text, 'suspended'::text, 'decommissioning'::text]))",
    );
    expect(building?.indexdef).toContain(
      "WHERE (status = ANY (ARRAY['provisioning'::text, 'failed'::text]))",
    );
  });
});
