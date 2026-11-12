import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("paper_stock", "deliveryNote"))) {
    await knex.schema.alterTable("paper_stock", (table) => {
      table.string("deliveryNote", 50).nullable();
    });
  }
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
