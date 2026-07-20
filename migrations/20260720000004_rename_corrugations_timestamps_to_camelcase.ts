import type { Knex } from "knex";

/**
 * corrugations still had snake_case created_at/updated_at while the DAO reads
 * and writes camelCase — every update 500'd ("column updatedAt does not
 * exist") and list responses carried empty timestamps. Same rename the other
 * tables received in 20251102160004 / 20260211000002.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `ALTER TABLE corrugations RENAME COLUMN created_at TO "createdAt"`,
  );
  await knex.schema.raw(
    `ALTER TABLE corrugations RENAME COLUMN updated_at TO "updatedAt"`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `ALTER TABLE corrugations RENAME COLUMN "createdAt" TO created_at`,
  );
  await knex.schema.raw(
    `ALTER TABLE corrugations RENAME COLUMN "updatedAt" TO updated_at`,
  );
}
