import type { Knex } from "knex";

/**
 * Fix typo in flute_types table: rename flueFactor to fluteFactor
 * The original migration had a typo (flue_factor instead of flute_factor)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN "flueFactor" TO "fluteFactor"',
  );
}

/**
 * Rollback: Rename fluteFactor back to flueFactor
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE flute_types RENAME COLUMN "fluteFactor" TO "flueFactor"',
  );
}
