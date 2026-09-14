import type { Knex } from "knex";

/**
 * app_config — per-company typed key/value settings store.
 *
 * Replaces Procusto's `ItemsDeConfiguracion` EAV table (spec:
 * specs/replication/modules/01-system-and-cross-cutting/configuration.md).
 * Values are stored stringified; `valueType` drives safe coercion on read.
 * Absent rows fall back to the seeded defaults in code (no null-row auto-insert).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("app_config", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("key", 200).notNullable();
    table.text("value");
    table
      .enu("valueType", ["bool", "int", "double", "short", "string"])
      .notNullable()
      .defaultTo("string");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "key"]);
    table.index(["companyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("app_config");
}
