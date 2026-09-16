import type { Knex } from "knex";
import {
  addOrderProductColumns,
  addProductRecipeColumns,
  runFoldBackfills,
  setFoldAuditContext,
} from "../../src/database/parts-fold";

/**
 * Core mirror of `migrations/tenant/20260916120000_fold_parts_into_products_expand`
 * for databases whose business tables are still live here (shared-target
 * locals, scratch bootstraps — `migrate-all` never runs tenant migrations on
 * them, C-4). Parked cores (`zz_old_*`) skip.
 *
 * remove-composite-products, expand half (model.md rev 2, D-15). The fleet
 * migrates before the container swap, so the previous image — which still
 * reads `parts` and writes `partId` — must keep working on this schema (I-18):
 * nothing is dropped here, the sales-order discriminator only widens, and
 * `production_orders."partId"` only loses its NOT NULL. The contract half is
 * `20260916130000_fold_parts_into_products_contract`, shipped one deploy later.
 */
export async function up(knex: Knex): Promise<void> {
  if (
    !(await knex.schema.hasTable("products")) ||
    !(await knex.schema.hasTable("parts"))
  ) {
    console.log(
      "fold_parts_into_products_expand: skipped — business tables are not live in this database",
    );
    return;
  }
  await setFoldAuditContext(knex);
  await addProductRecipeColumns(knex);
  await addOrderProductColumns(knex);

  if (await knex.schema.hasColumn("sales_orders", "partId")) {
    await knex.raw(
      `ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_tph_check`,
    );
    await knex.raw(
      `ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_tph_check CHECK (num_nonnulls("productId", "sheetSupplyId") = 1 OR "partId" IS NOT NULL)`,
    );
  }
  if (await knex.schema.hasColumn("production_orders", "partId")) {
    await knex.raw(
      `ALTER TABLE production_orders ALTER COLUMN "partId" DROP NOT NULL`,
    );
  }

  await runFoldBackfills(knex, "expand");
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
