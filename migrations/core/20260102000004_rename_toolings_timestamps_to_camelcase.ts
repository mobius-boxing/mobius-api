import type { Knex } from "knex";

/**
 * Rename toolings timestamp columns from snake_case to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE toolings RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE toolings RENAME COLUMN updated_at TO "updatedAt"',
  );
}

/**
 * Rollback: Rename toolings timestamp columns from camelCase to snake_case
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE toolings RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE toolings RENAME COLUMN "updatedAt" TO updated_at',
  );
}
