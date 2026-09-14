import type { Knex } from "knex";

/**
 * Add grammage, paperTypeId, and price columns to paper_supplies table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("paper_supplies", function (table) {
    // Grammage in grams per square meter (g/m²)
    table.decimal("grammage", 10, 2);

    // Foreign key to paper_types
    table
      .integer("paperTypeId")
      .references("id")
      .inTable("paper_types")
      .onDelete("SET NULL");

    // Price (decimal for currency)
    table.decimal("price", 12, 2);

    // Add index for paperTypeId for faster joins
    table.index(["paperTypeId"]);
  });
}

/**
 * Rollback: Remove the added columns
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("paper_supplies", function (table) {
    table.dropIndex(["paperTypeId"]);
    table.dropColumn("grammage");
    table.dropColumn("paperTypeId");
    table.dropColumn("price");
  });
}
