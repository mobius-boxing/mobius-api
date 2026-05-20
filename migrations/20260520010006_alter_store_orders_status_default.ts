import type { Knex } from "knex";

// Store order status model changed from submitted/processing/fulfilled/cancelled
// to the approval lifecycle pending → confirmed → in_production → shipped → delivered.
// New orders start at 'pending'. Status is a plain text column (no enum/CHECK — validated in TS).
// 0 rows exist in the target DB, so this only swaps the column DEFAULT; no data backfill needed.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("store_orders", (table) => {
    table.text("status").notNullable().defaultTo("pending").alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("store_orders", (table) => {
    table.text("status").notNullable().defaultTo("submitted").alter();
  });
}
