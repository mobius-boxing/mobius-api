import type { Knex } from "knex";

/**
 * corrugation_layers — Procusto `Capas` (module 05, decision log §L.1).
 * A Corrugado is a stack of layers; multi-wall is the norm at the live customer
 * (17/21 boards). Per-layer fields confirmed by user observation 2026-07-20:
 * Posición, Liner flag, Clase de papel, Tipo de onda (flute factor read from
 * the flute type until per-layer editability is verified).
 *
 * Child of corrugations (company scope derives from the parent, like
 * warehouse_locations). Positions are 1..N unique per corrugation; the grid is
 * replaced wholesale on edit.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("corrugation_layers", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("corrugationId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("corrugations")
      .onDelete("CASCADE");
    table.integer("position").notNullable();
    table.boolean("isLiner").notNullable().defaultTo(false);
    table
      .integer("paperClassId")
      .unsigned()
      .references("id")
      .inTable("paper_classes")
      .onDelete("SET NULL");
    table
      .integer("fluteTypeId")
      .unsigned()
      .references("id")
      .inTable("flute_types")
      .onDelete("SET NULL");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["corrugationId", "position"]);
    table.index(["corrugationId"]);
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("corrugation_layers");
}
