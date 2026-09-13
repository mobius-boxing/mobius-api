import type { Knex } from "knex";
import { tablesOf } from "./ownership";

/** `pg_constraint.confdeltype`, spelled as `information_schema` spells it. */
export type ForeignKeyDeleteRule =
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT"
  | "RESTRICT"
  | "NO ACTION";

/** One column of a foreign key from a tenant table to a central-only table. */
export type CrossPlaneRef = {
  constraintName: string;
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  deleteRule: ForeignKeyDeleteRule;
  nullable: boolean;
};

/**
 * Every foreign key that stops being expressible once a tenant's tables live
 * in their own database: source in the tenant plane, target only in the
 * central plane. Read from the catalogue, never hand-maintained (model U-14).
 *
 * `files` and `audit_logs` exist in both planes, so a reference *to* them stays
 * intra-tenant and is not listed, while a reference *from* them to `users` or
 * `companies` is.
 *
 * Partitions are skipped: Postgres clones a partitioned table's foreign keys
 * onto every partition, and those clones are storage, not references of their
 * own.
 */
export async function crossPlaneRefs(knex: Knex): Promise<CrossPlaneRef[]> {
  const tenantTables = tablesOf("tenant");
  const centralOnlyTables = tablesOf("core").filter(
    (table) => !tenantTables.includes(table),
  );
  const result = (await knex.raw(
    `select con.conname as "constraintName",
            src.relname as "table",
            src_col.attname as "column",
            ref.relname as "referencedTable",
            ref_col.attname as "referencedColumn",
            case con.confdeltype
              when 'c' then 'CASCADE'
              when 'n' then 'SET NULL'
              when 'd' then 'SET DEFAULT'
              when 'r' then 'RESTRICT'
              else 'NO ACTION'
            end as "deleteRule",
            not src_col.attnotnull as "nullable"
       from pg_constraint con
       join pg_class src on src.oid = con.conrelid
       join pg_namespace ns on ns.oid = src.relnamespace
       join pg_class ref on ref.oid = con.confrelid
      cross join lateral unnest(con.conkey, con.confkey) as cols(src_num, ref_num)
       join pg_attribute src_col
         on src_col.attrelid = con.conrelid and src_col.attnum = cols.src_num
       join pg_attribute ref_col
         on ref_col.attrelid = con.confrelid and ref_col.attnum = cols.ref_num
      where con.contype = 'f'
        and ns.nspname = 'public'
        and not src.relispartition
        and src.relname = any(?)
        and ref.relname = any(?)
      order by src.relname, src_col.attname, con.conname`,
    [tenantTables, centralOnlyTables],
  )) as { rows: CrossPlaneRef[] };
  return result.rows;
}
