import type { Knex } from "knex";

/**
 * Create companies table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("companies", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.text("description");
    table.boolean("isActive").defaultTo(true);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(["isActive"]);
    table.index(["name"]);
  });
}

/**
 * Rollback: Drop companies table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("companies");
}
