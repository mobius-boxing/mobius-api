import type { Knex } from "knex";

/**
 * Sprint 1.2 — missing material lookups (module 05, decision log §L):
 * color_types (Procusto TiposColor), colors (Colores), fsc_types (TiposDeFSC),
 * plus the FK wiring on paper_supplies (fscTypeId) and consumable_supplies
 * (colorId — Procusto Consumible.Color_Id is a FK, unlike Papel.Color free text).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("color_types", function (table) {
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
    table.string("name", 255).notNullable();
    table.text("description");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"]);
    table.index(["companyId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable("colors", function (table) {
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
    table.string("code", 400);
    table.string("name", 255);
    table.text("description");
    table.text("observations");
    // Print-shade index (Tonalidad) — semantics refine later (Q-05-8, 🟡).
    table.integer("tonality");
    table
      .integer("colorTypeId")
      .unsigned()
      .references("id")
      .inTable("color_types")
      .onDelete("SET NULL");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    table.index(["companyId"]);
    table.index(["colorTypeId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable("fsc_types", function (table) {
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
    table.string("code", 400);
    table.text("description");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    table.index(["companyId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.alterTable("paper_supplies", function (table) {
    table
      .integer("fscTypeId")
      .unsigned()
      .references("id")
      .inTable("fsc_types")
      .onDelete("SET NULL");
    table.index(["fscTypeId"]);
  });

  await knex.schema.alterTable("consumable_supplies", function (table) {
    table
      .integer("colorId")
      .unsigned()
      .references("id")
      .inTable("colors")
      .onDelete("SET NULL");
    table.index(["colorId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("consumable_supplies", function (table) {
    table.dropIndex(["colorId"]);
    table.dropColumn("colorId");
  });
  await knex.schema.alterTable("paper_supplies", function (table) {
    table.dropIndex(["fscTypeId"]);
    table.dropColumn("fscTypeId");
  });
  await knex.schema.dropTableIfExists("fsc_types");
  await knex.schema.dropTableIfExists("colors");
  await knex.schema.dropTableIfExists("color_types");
}
