import type { Knex } from "knex";

/**
 * Create customer_categories table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("customer_categories", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table
      .integer("company_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.timestamps(true, true);

    // Indexes for performance
    table.index(["company_id"]);
    table.index(["name"]);
    table.unique(["company_id", "name"]); // Unique category name per company
  });
}

/**
 * Rollback: Drop customer_categories table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("customer_categories");
}
