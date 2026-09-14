/**
 * AC-19 (db-per-company T4) — the cross-plane reference set, read two ways.
 *
 * `crossPlaneRefs` walks `pg_constraint`; this suite reads the same set from
 * `information_schema` independently and requires them to be equal, so neither
 * can drift into a hand-maintained list (U-14). It also holds the module
 * manifests' declared user columns to the schema: each must exist, carry no
 * foreign key (or the catalogue already reports it), match its declared
 * nullability, and be integer-typed like `users.id` — `nf_runs.lockedBy`, a
 * varchar worker-lock id, is exactly what must never be declared (T4/D-orch-7).
 *
 * Run from `repos/mobius-api` against a local copy:
 *
 *   SQL_HOST=localhost SQL_PORT=5432 SQL_USER=… SQL_PASSWORD=… \
 *   SQL_DATABASE=… npx jest src/__tests__/schema/foreign-keys.schema.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { knex as createKnex, type Knex } from "knex";
import { connectionFor } from "../../database/env";
import { tablesOf } from "../../database/ownership";
import { crossPlaneRefs } from "../../database/cross-plane-refs";
import { declaredUserReferences } from "../../modules/registry";

const isLocalDb =
  process.env.SQL_HOST === "localhost" || process.env.SQL_HOST === "127.0.0.1";
const describeIfLocalDb = isLocalDb ? describe : describe.skip;

const INTEGER_TYPES = ["smallint", "integer", "bigint"];

type Ref = {
  constraintName: string;
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  deleteRule: string;
  nullable: boolean;
};

const key = (r: Ref): string =>
  `${r.constraintName}|${r.table}.${r.column}→${r.referencedTable}.${r.referencedColumn}|${r.deleteRule}|${r.nullable}`;

describeIfLocalDb("cross-plane references against the live schema", () => {
  let knex: Knex;

  beforeAll(() => {
    const c = connectionFor("core");
    knex = createKnex({
      client: "pg",
      connection: {
        host: c.host,
        port: c.port,
        database: c.database,
        user: c.user,
        password: c.password,
      },
      pool: { min: 0, max: 2 },
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it("equals the set information_schema reports for tenant tables referencing central-only tables", async () => {
    const tenant = tablesOf("tenant");
    const centralOnly = tablesOf("core").filter((t) => !tenant.includes(t));
    const { rows } = (await knex.raw(
      `select rc.constraint_name as "constraintName",
              kcu.table_name as "table",
              kcu.column_name as "column",
              pk.table_name as "referencedTable",
              pk.column_name as "referencedColumn",
              rc.delete_rule as "deleteRule",
              col.is_nullable = 'YES' as "nullable"
         from information_schema.referential_constraints rc
         join information_schema.key_column_usage kcu
           on kcu.constraint_schema = rc.constraint_schema
          and kcu.constraint_name = rc.constraint_name
         join information_schema.key_column_usage pk
           on pk.constraint_schema = rc.unique_constraint_schema
          and pk.constraint_name = rc.unique_constraint_name
          and pk.ordinal_position = kcu.position_in_unique_constraint
         join information_schema.columns col
           on col.table_schema = kcu.table_schema
          and col.table_name = kcu.table_name
          and col.column_name = kcu.column_name
        where rc.constraint_schema = 'public'
          and kcu.table_name = any(?)
          and pk.table_name = any(?)`,
      [tenant, centralOnly],
    )) as { rows: Ref[] };

    const fromCatalogue = (await crossPlaneRefs(knex)).map(key).sort();
    expect(fromCatalogue.length).toBeGreaterThan(0);
    expect(fromCatalogue).toEqual(rows.map(key).sort());
  });

  it("holds every declared user column to the schema: present, integer, declared nullability, no foreign key", async () => {
    const declared = declaredUserReferences();
    expect(declared.length).toBeGreaterThan(0);
    const constrained = new Set(
      (await crossPlaneRefs(knex)).map((r) => `${r.table}.${r.column}`),
    );
    const { rows } = (await knex.raw(
      `select table_name as "table", column_name as "column", data_type as "type",
              is_nullable = 'YES' as "nullable"
         from information_schema.columns
        where table_schema = 'public'`,
    )) as {
      rows: { table: string; column: string; type: string; nullable: boolean }[];
    };
    const columns = new Map(rows.map((r) => [`${r.table}.${r.column}`, r]));

    const mismatches = declared.flatMap((ref) => {
      const name = `${ref.table}.${ref.column}`;
      const column = columns.get(name);
      if (!column) return [`${name}: no such column`];
      return [
        ...(INTEGER_TYPES.includes(column.type)
          ? []
          : [`${name}: ${column.type} cannot hold a users.id`]),
        ...(column.nullable === ref.nullable
          ? []
          : [`${name}: declared nullable=${ref.nullable}, schema says ${column.nullable}`]),
        ...(constrained.has(name) ? [`${name}: has a foreign key; drop the declaration`] : []),
      ];
    });
    expect(mismatches).toEqual([]);
  });
});
