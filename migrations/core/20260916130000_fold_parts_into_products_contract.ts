import type { Knex } from "knex";
import {
  runFoldBackfills,
  setFoldAuditContext,
} from "../../src/database/parts-fold";

/**
 * Core mirror of `migrations/tenant/20260916130000_fold_parts_into_products_contract`
 * for databases whose business tables are still live here (C-4); parked cores
 * skip.
 *
 * remove-composite-products, contract half (model.md rev 2, D-15). Ships one
 * deploy after the expand half: by then the running image never reads `parts`
 * or any `partId` (I-17), so dropping them cannot break it mid-deploy.
 *
 * The backfills re-run first for rows the pre-expand image wrote while the
 * expand deploy's fleet run was in flight. The tables are dropped, not parked
 * (D-9): tenant databases must hold exactly `tablesOf("tenant")`, and the
 * deploy's per-database `pg_dump` to S3 is the recovery path.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("products"))) {
    console.log(
      "fold_parts_into_products_contract: skipped — business tables are not live in this database",
    );
    return;
  }
  await setFoldAuditContext(knex);
  await runFoldBackfills(knex, "contract");

  if (await knex.schema.hasColumn("production_orders", "partId")) {
    const [{ unresolved }] = (
      await knex.raw(
        `SELECT count(*)::int AS unresolved FROM production_orders WHERE "productId" IS NULL`,
      )
    ).rows;
    if (unresolved > 0) {
      throw new Error(
        `fold_parts_into_products_contract: ${unresolved} production orders have no product — refusing to drop "partId"`,
      );
    }
    await knex.raw(
      `ALTER TABLE production_orders ALTER COLUMN "productId" SET NOT NULL`,
    );
    await knex.raw(
      `ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_partid_foreign`,
    );
    await knex.raw(`DROP INDEX IF EXISTS production_orders_partid_index`);
    await knex.raw(`ALTER TABLE production_orders DROP COLUMN "partId"`);
  }

  if (await knex.schema.hasColumn("sales_orders", "partId")) {
    await knex.raw(
      `ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_partid_foreign`,
    );
    await knex.raw(`ALTER TABLE sales_orders DROP COLUMN "partId"`);
    await knex.raw(
      `ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_tph_check`,
    );
    await knex.raw(
      `ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_tph_check CHECK (num_nonnulls("productId", "sheetSupplyId") = 1)`,
    );
  }

  if (await knex.schema.hasColumn("finished_goods", "partId")) {
    await knex.raw(`ALTER TABLE finished_goods DROP COLUMN "partId"`);
  }

  await knex.raw(`DROP TABLE IF EXISTS part_approval_events`);
  await knex.raw(`DROP TABLE IF EXISTS parts`);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
