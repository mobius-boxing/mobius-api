import type { Knex } from "knex";

/**
 * Create paper_sheets table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("paper_sheets", function (table) {
    // Primary keys and UUID
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));

    // Data columns (camelCase)
    table.string("code").notNullable();
    table.string("name").notNullable();
    table.text("description");

    // Foreign keys (camelCase)
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
      .integer("corrugationId")
      .unsigned()
      .references("id")
      .inTable("corrugations")
      .onDelete("SET NULL");

    // Numeric columns
    table.integer("minimumStock").defaultTo(0);
    table.decimal("length", 10, 2);
    table.decimal("width", 10, 2);

    // Timestamps (camelCase)
    table.timestamps(true, true);

    // Indexes for performance
    table.index(["supplierId"]);
    table.index(["manufacturerId"]);
    table.index(["corrugationId"]);
    table.index(["code"]);
  });
}

/**
 * Rollback: Drop paper_sheets table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("paper_sheets");
}
