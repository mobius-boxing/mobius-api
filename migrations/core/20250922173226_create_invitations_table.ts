import type { Knex } from "knex";

/**
 * Create invitations table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("invitations", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("email").notNullable();
    table.string("token").unique().notNullable();
    table.enu("role", ["member", "admin"]).notNullable();
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .integer("invitedBy")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.timestamp("expiresAt").notNullable();
    table.timestamp("acceptedAt");
    table.boolean("isUsed").defaultTo(false);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(["email", "companyId"]);
    table.index(["token"]);
    table.index(["companyId"]);
    table.index(["invitedBy"]);
    table.index(["isUsed"]);
    table.index(["expiresAt"]);
  });
}

/**
 * Rollback: Drop invitations table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("invitations");
}
