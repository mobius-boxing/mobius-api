import type { Knex } from "knex";

const tables = ["glue_types", "strapping_types", "complements", "trace_types"];

export async function up(knex: Knex): Promise<void> {
  for (const tableName of tables) {
    await knex.schema.raw(
      `ALTER TABLE ${tableName} RENAME COLUMN created_at TO "createdAt"`,
    );
    await knex.schema.raw(
      `ALTER TABLE ${tableName} RENAME COLUMN updated_at TO "updatedAt"`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const tableName of tables) {
    await knex.schema.raw(
      `ALTER TABLE ${tableName} RENAME COLUMN "createdAt" TO created_at`,
    );
    await knex.schema.raw(
      `ALTER TABLE ${tableName} RENAME COLUMN "updatedAt" TO updated_at`,
    );
  }
}
