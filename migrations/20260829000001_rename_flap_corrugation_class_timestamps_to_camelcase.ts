import type { Knex } from "knex";

/**
 * flap_types and corrugation_classes still had snake_case
 * created_at/updated_at while their DAOs read and write camelCase — every
 * update 500'd ("column updatedAt does not exist") and list responses carried
 * empty timestamps. Same rename the other tables received in
 * 20251102160004 / 20260211000002 / 20260720000004.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `ALTER TABLE flap_types RENAME COLUMN created_at TO "createdAt"`,
  );
  await knex.schema.raw(
    `ALTER TABLE flap_types RENAME COLUMN updated_at TO "updatedAt"`,
  );
  await knex.schema.raw(
    `ALTER TABLE corrugation_classes RENAME COLUMN created_at TO "createdAt"`,
  );
  await knex.schema.raw(
    `ALTER TABLE corrugation_classes RENAME COLUMN updated_at TO "updatedAt"`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `ALTER TABLE flap_types RENAME COLUMN "createdAt" TO created_at`,
  );
  await knex.schema.raw(
    `ALTER TABLE flap_types RENAME COLUMN "updatedAt" TO updated_at`,
  );
  await knex.schema.raw(
    `ALTER TABLE corrugation_classes RENAME COLUMN "createdAt" TO created_at`,
  );
  await knex.schema.raw(
    `ALTER TABLE corrugation_classes RENAME COLUMN "updatedAt" TO updated_at`,
  );
}
