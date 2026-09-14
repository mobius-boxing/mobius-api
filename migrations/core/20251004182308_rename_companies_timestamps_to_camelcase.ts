import type { Knex } from "knex";

/**
 * Rename companies timestamp columns from snake_case to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE companies RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE companies RENAME COLUMN updated_at TO "updatedAt"',
  );
}

/**
 * Rollback: Rename companies timestamp columns from camelCase to snake_case
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE companies RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE companies RENAME COLUMN "updatedAt" TO updated_at',
  );
}
