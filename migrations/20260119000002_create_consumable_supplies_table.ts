import type { Knex } from "knex";

/**
 * Create consumable_supplies table
 * Supply entity for consumable inventory items
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("consumable_supplies", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code").notNullable();
    table.string("name").notNullable();
    table.text("description");
    table
      .integer("supplierId")
      .unsigned()
      .references("id")
      .inTable("suppliers")
      .onDelete("SET NULL");
    table
      .integer("manufacturerId")
      .unsigned()
      .references("id")
      .inTable("manufacturers")
      .onDelete("SET NULL");
    table
      .integer("consumableTypeId")
      .unsigned()
      .references("id")
      .inTable("consumable_types")
      .onDelete("SET NULL");
    table.timestamp("createdAt").defaultTo(knex.fn.now());
    table.timestamp("updatedAt").defaultTo(knex.fn.now());

    table.index(["code"]);
    table.index(["name"]);
    table.index(["supplierId"]);
    table.index(["manufacturerId"]);
    table.index(["consumableTypeId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("consumable_supplies");
}
