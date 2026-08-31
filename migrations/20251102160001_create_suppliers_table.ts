import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("suppliers", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code", 100).notNullable().unique();
    table.boolean("supplies_sheets").defaultTo(false);
    table.boolean("supplies_elaborated").defaultTo(false);
    table.boolean("supplies_consumables").defaultTo(false);
    table.boolean("supplies_paper").defaultTo(false);
    table.boolean("supplies_tooling").defaultTo(false);
    table.timestamps(true, true);

    table.index(["code"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("suppliers");
}
