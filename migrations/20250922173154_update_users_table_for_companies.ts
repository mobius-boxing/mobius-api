import type { Knex } from "knex";

/**
 * Update users table to add company relationship and rename columns to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  // Add new columns
  await knex.schema.alterTable("users", function (table) {
    table
      .integer("companyId")
      .unsigned()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.boolean("emailVerified").defaultTo(false);
  });

  // Rename columns to camelCase - must be done sequentially
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN first_name TO "firstName"',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN last_name TO "lastName"',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN is_active TO "isActive"',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Drop the old role column and add new enum
  await knex.schema.alterTable("users", function (table) {
    table.dropColumn("role");
  });

  await knex.schema.alterTable("users", function (table) {
    table
      .enu("role", ["member", "admin", "superAdmin"])
      .notNullable()
      .defaultTo("member");
  });

  // Add indexes for performance
  await knex.schema.alterTable("users", function (table) {
    table.index(["companyId"]);
    table.index(["role"]);
    table.index(["isActive"]);
    table.index(["emailVerified"]);
  });
}

/**
 * Rollback: Restore original users table structure
 */
export async function down(knex: Knex): Promise<void> {
  // Drop new columns
  await knex.schema.alterTable("users", function (table) {
    table.dropColumn("companyId");
    table.dropColumn("emailVerified");
    table.dropColumn("role");
  });

  // Restore old column names
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN "firstName" TO first_name',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN "lastName" TO last_name',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN "isActive" TO is_active',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE users RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Add back old role column
  await knex.schema.alterTable("users", function (table) {
    table.string("role").defaultTo("user");
  });
}
