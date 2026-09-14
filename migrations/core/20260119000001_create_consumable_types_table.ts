import type { Knex } from "knex";

/**
 * Create consumable_types table
 * Master entity for consumable type definitions
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("consumable_types", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code").notNullable();
    table.string("name").notNullable();
    table.boolean("autoConsumption").defaultTo(false);
    table.timestamp("createdAt").defaultTo(knex.fn.now());
    table.timestamp("updatedAt").defaultTo(knex.fn.now());

    table.index(["code"]);
    table.index(["name"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("consumable_types");
}
