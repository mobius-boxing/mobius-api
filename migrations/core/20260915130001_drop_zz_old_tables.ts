import type { Knex } from "knex";

/**
 * C4 of the db-per-company cutover: drops the central copies that
 * `park_tenant_tables` renamed to `zz_old_*`. Irreversible — afterwards those
 * rows exist only in the pre-C3 dumps (s3 backups/c3-2026-09-15/).
 */
export async function up(knex: Knex): Promise<void> {
  const parked: { tablename: string }[] = (
    await knex.raw(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'zz\\_old\\_%'",
    )
  ).rows;
  if (parked.length === 0) return;
  // One statement, because the parked tables reference each other and a
  // table-by-table drop would need their dependency order.
  await knex.raw(
    `DROP TABLE IF EXISTS ${parked.map(() => "??").join(", ")}`,
    parked.map((row) => row.tablename),
  );
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
