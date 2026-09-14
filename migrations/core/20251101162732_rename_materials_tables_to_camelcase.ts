import type { Knex } from "knex";

/**
 * Rename materials tables timestamp columns from snake_case to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  // Rename paper_types columns
  await knex.schema.raw(
    'ALTER TABLE paper_types RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_types RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Rename flute_types columns
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN updated_at TO "updatedAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN flue_factor TO "flueFactor"',
  );

  // Rename paper_classes columns
  await knex.schema.raw(
    'ALTER TABLE paper_classes RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_classes RENAME COLUMN updated_at TO "updatedAt"',
  );
}

/**
 * Rollback: Rename materials tables timestamp columns from camelCase to snake_case
 */
export async function down(knex: Knex): Promise<void> {
  // Rollback paper_types columns
  await knex.schema.raw(
    'ALTER TABLE paper_types RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_types RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Rollback flute_types columns
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN "updatedAt" TO updated_at',
  );
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN "flueFactor" TO flue_factor',
  );

  // Rollback paper_classes columns
  await knex.schema.raw(
    'ALTER TABLE paper_classes RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_classes RENAME COLUMN "updatedAt" TO updated_at',
  );
}
