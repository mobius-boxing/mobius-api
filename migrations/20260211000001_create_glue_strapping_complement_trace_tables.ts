import type { Knex } from "knex";

/**
 * Create glue_types, strapping_types, complements, and trace_types tables
 */
export async function up(knex: Knex): Promise<void> {
  const tables = [
    "glue_types",
    "strapping_types",
    "complements",
    "trace_types",
  ];

  for (const tableName of tables) {
    await knex.schema.createTable(tableName, function (table) {
      table.increments("id").primary();
      table
        .uuid("uuid")
        .unique()
        .notNullable()
        .defaultTo(knex.raw("gen_random_uuid()"));
      table
        .integer("companyId")
        .unsigned()
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
      table.string("code", 50).notNullable();
      table.text("description");
      table.timestamps(true, true);

      table.unique(["companyId", "code"]);
      table.index(["code"]);
      table.index(["companyId"]);
    });
  }
}

/**
 * Rollback: Drop all 4 tables
 */
export async function down(knex: Knex): Promise<void> {
  const tables = [
    "trace_types",
    "complements",
    "strapping_types",
    "glue_types",
  ];

  for (const tableName of tables) {
    await knex.schema.dropTableIfExists(tableName);
  }
}
