import type { Knex } from "knex";

/**
 * Create emailTokens table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("emailTokens", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("userId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("token").unique().notNullable();
    table.enu("type", ["email_verification", "password_reset"]).notNullable();
    table.timestamp("expiresAt").notNullable();
    table.boolean("isUsed").defaultTo(false);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(["token"]);
    table.index(["userId", "type"]);
    table.index(["expiresAt"]);
    table.index(["isUsed"]);
  });
}

/**
 * Rollback: Drop emailTokens table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("emailTokens");
}
