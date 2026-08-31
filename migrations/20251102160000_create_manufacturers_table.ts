import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("manufacturers", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code", 100).notNullable().unique();
    table.string("name", 255).notNullable();
    table.timestamps(true, true);

    table.index(["code"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("manufacturers");
}
