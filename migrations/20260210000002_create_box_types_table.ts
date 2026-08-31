import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("box_types", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("code", 50).notNullable();
    table.string("name", 255).notNullable();
    table.timestamps(true, true);

    // Indexes
    table.index(["companyId"]);
    table.unique(["code", "companyId"]); // Code unique per company
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("box_types");
}
