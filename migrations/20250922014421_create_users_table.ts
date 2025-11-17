import type { Knex } from "knex";

/**
 * Create users table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("email").unique().notNullable();
    table.string("password").notNullable();
    table.string("first_name").notNullable();
    table.string("last_name").notNullable();
    table.string("role").defaultTo("user");
    table.boolean("is_active").defaultTo(true);
    table.timestamps(true, true);
  });
}

/**
 * Rollback: Drop users table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("users");
}
