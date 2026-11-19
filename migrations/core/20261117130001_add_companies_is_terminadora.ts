import type { Knex } from "knex";

/** `companies` is core-only, so there is no tenant mirror (model-r2 §Persistence). */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("companies", "isTerminadora"))) {
    await knex.schema.alterTable("companies", (table) => {
      table.boolean("isTerminadora").notNullable().defaultTo(false);
    });
  }
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
