import type { Knex } from "knex";

/**
 * Rename paper_sheets timestamp columns from snake_case to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE paper_sheets RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_sheets RENAME COLUMN updated_at TO "updatedAt"',
  );
}

/**
 * Rollback: Rename paper_sheets timestamp columns from camelCase to snake_case
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE paper_sheets RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_sheets RENAME COLUMN "updatedAt" TO updated_at',
  );
}
