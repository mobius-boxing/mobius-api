import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("warehouses", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable();
    table.timestamps(true, true);

    table.index(["name"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("warehouses");
}
