import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", function (table) {
    table.integer("revision").notNullable().defaultTo(0);
    table.boolean("vip").notNullable().defaultTo(false);
    table
      .integer("productTypeId")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("product_types")
      .onDelete("SET NULL");
    table
      .integer("boxTypeId")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("box_types")
      .onDelete("SET NULL");

    // Indexes
    table.index(["productTypeId"]);
    table.index(["boxTypeId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", function (table) {
    table.dropColumn("boxTypeId");
    table.dropColumn("productTypeId");
    table.dropColumn("vip");
    table.dropColumn("revision");
  });
}
