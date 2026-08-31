import type { Knex } from "knex";

/**
 * Rename product_types and box_types timestamp columns from snake_case to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  // Product Types
  await knex.schema.raw(
    'ALTER TABLE product_types RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE product_types RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Box Types
  await knex.schema.raw(
    'ALTER TABLE box_types RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE box_types RENAME COLUMN updated_at TO "updatedAt"',
  );
}

/**
 * Rollback: Rename product_types and box_types timestamp columns from camelCase to snake_case
 */
export async function down(knex: Knex): Promise<void> {
  // Product Types
  await knex.schema.raw(
    'ALTER TABLE product_types RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE product_types RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Box Types
  await knex.schema.raw(
    'ALTER TABLE box_types RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE box_types RENAME COLUMN "updatedAt" TO updated_at',
  );
}
