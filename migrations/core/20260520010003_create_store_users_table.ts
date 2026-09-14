import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("store_users", function (table) {
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

    table.text("email").notNullable();
    table.text("passwordHash").nullable(); // null until set / invite accepted
    table.text("firstName").nullable();
    table.text("lastName").nullable();

    table.boolean("isActive").notNullable().defaultTo(true);
    table.boolean("emailVerified").notNullable().defaultTo(false);

    table.text("invitationToken").nullable();
    table.timestamp("invitationExpiresAt", { useTz: true }).nullable();
    table
      .integer("invitedBy")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.timestamp("lastLoginAt", { useTz: true }).nullable();

    // Timestamps (camelCase)
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.unique(["companyId", "email"]);
    table.index(["companyId"]);
  });

  // Case-insensitive email lookup (functional index — Knex builder can't express it).
  await knex.schema.raw(
    `CREATE INDEX idx_store_users_lower_email ON store_users (LOWER(email))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(`DROP INDEX IF EXISTS idx_store_users_lower_email`);
  await knex.schema.dropTable("store_users");
}
