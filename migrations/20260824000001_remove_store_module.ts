import type { Knex } from "knex";

/**
 * Delete the store module — tables, catalogue row and per-company enablement.
 *
 * The store module was spun out to the standalone **rolpel** app. What remained
 * in this database was a superseded copy, confirmed on the live host
 * 2026-08-24: `rolpel_production` holds the same 6 orders and 8 order items with
 * an identical latest-order timestamp (`2026-05-24 22:28:44.526`), plus an
 * `order_events` table this schema never had, and nothing had written to
 * `store_*` in three months. The human confirmed the rows are not real
 * production data and asked for no backup.
 *
 * Plan context: `docs/dev/db-per-module-split/amendment-2026-08-24.md`. This
 * replaces track T5 (the store cutover) — the module is deleted instead of
 * being moved to its own database, which removes one write-freeze window from
 * the split and shrinks T2b/T2d/T3.
 *
 * Drop order is FK-topological: `store_order_items` → `store_orders` →
 * (`store_users`, `store_boxes`, `store_rolls`). `company_modules` rows go
 * before the `modules` row they reference.
 *
 * `down()` REFUSES. Re-creating five empty tables would not restore the data and
 * would silently re-register a module whose 42 source files no longer exist —
 * a worse state than the failure. Prod is roll-forward only (L-003).
 */
export async function up(knex: Knex): Promise<void> {
  // Enablement first: FK to modules.id.
  await knex.raw(
    `DELETE FROM company_modules
      WHERE "moduleId" IN (SELECT id FROM modules WHERE slug = 'store')`,
  );
  await knex.raw(`DELETE FROM modules WHERE slug = 'store'`);

  await knex.schema.dropTableIfExists("store_order_items");
  await knex.schema.dropTableIfExists("store_orders");
  await knex.schema.dropTableIfExists("store_users");
  await knex.schema.dropTableIfExists("store_boxes");
  await knex.schema.dropTableIfExists("store_rolls");
}

export async function down(): Promise<void> {
  throw new Error(
    "20260824000001_remove_store_module is irreversible: the store tables were " +
      "dropped with their data and the module's 42 source files were deleted in " +
      "the same change. Restore from a database backup instead of rolling back.",
  );
}
