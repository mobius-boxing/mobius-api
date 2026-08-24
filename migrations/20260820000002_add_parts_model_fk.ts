import type { Knex } from "knex";

/**
 * Module 08 — turn the `parts.modelId` placeholder (create_parts_tables.ts,
 * TODO(module-08)) into a real FK → models(id) ON DELETE RESTRICT (D-8:
 * deleting a referenced Modelo answers 409; the FK is the DB backstop).
 *
 * The column has never had a referent, so any existing value is an orphan by
 * construction — nulled defensively before the constraint lands.
 * `down()` drops ONLY the constraint, never the column.
 */
export async function up(knex: Knex): Promise<void> {
  await knex("parts").whereNotNull("modelId").update({ modelId: null });
  await knex.schema.alterTable("parts", function (table) {
    table
      .foreign("modelId")
      .references("id")
      .inTable("models")
      .onDelete("RESTRICT");
    table.index(["modelId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("parts", function (table) {
    table.dropIndex(["modelId"]);
    table.dropForeign(["modelId"]);
  });
}
