import type { Knex } from "knex";

/**
 * Production routes (module 12, FULL structure — route-lite refuted by the live
 * scorecard: multi-stage routes + stage I/O are load-bearing).
 *
 *  production_routes              ← RutasProduccion (name/global/active/default)
 *  production_route_stages        ← Etapas (Numero 1..N consecutive, renumbered;
 *                                   legacy EtapaPrevia/Siguiente DROPPED — the DAG
 *                                   is DERIVED from supply identity, never stored)
 *  production_route_stage_machines← Participantes (1 primary + N backups)
 *  production_route_stage_supplies← route-owned subset of InsumosProgramados
 *                                   (full semantics — orders/tasks linkage —
 *                                   arrive with modules 11/13)
 *
 * setupTimeMinutes: unit INFERRED as minutes (QA-VERIFY — tldr12 #6 open).
 * Numeric route math stays IEEE-754 double (spec 03): quantity columns are
 * `double precision`, NOT numeric, so Bocas float-equality (V4) reproduces.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("production_routes", function (table) {
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
    table.string("name", 400).notNullable();
    table.boolean("isGlobal").notNullable().defaultTo(false);
    table.boolean("active").notNullable().defaultTo(true);
    table.boolean("isDefault").notNullable().defaultTo(false);
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    // Procusto has no uniqueness on Nombre — index only (parity).
    table.index(["companyId", "name"]);
    table.index(["companyId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable("production_route_stages", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("routeId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("production_routes")
      .onDelete("CASCADE");
    table.integer("number").notNullable();
    table.text("description");
    table.boolean("isCorrugation");
    // QA-VERIFY: unit inferred as minutes (not unit-tagged in source).
    table.double("setupTimeMinutes").notNullable().defaultTo(0);
    table
      .integer("machineTypeId")
      .unsigned()
      .references("id")
      .inTable("machine_types")
      .onDelete("SET NULL");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["routeId", "number"]);
    table.index(["routeId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable(
    "production_route_stage_machines",
    function (table) {
      table.increments("id").primary();
      table
        .integer("stageId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("production_route_stages")
        .onDelete("CASCADE");
      table
        .integer("machineId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("machines")
        .onDelete("CASCADE");
      table.boolean("isPrimary").notNullable().defaultTo(true);
      table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());

      table.unique(["stageId", "machineId"]);
      table.index(["machineId"]);
    },
  );

  await knex.schema.createTable(
    "production_route_stage_supplies",
    function (table) {
      table.increments("id").primary();
      table
        .uuid("uuid")
        .unique()
        .notNullable()
        .defaultTo(knex.raw("gen_random_uuid()"));
      table
        .integer("stageId")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("production_route_stages")
        .onDelete("CASCADE");
      table.enu("direction", ["input", "output"]).notNullable();
      // Polymorphic supply reference: id within the supplyType's table.
      // No FK constraint by design (TPH flattening); identity = (supplyType, supplyId).
      table
        .enu("supplyType", [
          "paper",
          "sheet",
          "consumable",
          "tooling",
          "finishedGood",
        ])
        .notNullable();
      table.integer("supplyId").notNullable();
      table.double("quantity");
      table.string("quantityType", 50);
      table.double("repetitionsWidth").notNullable().defaultTo(1.0);
      table.double("repetitionsLength").notNullable().defaultTo(1.0);
      table.boolean("allowsSimilar").notNullable().defaultTo(false);
      table.text("notes");
      table.integer("legacyId");
      table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());

      table.index(["stageId"]);
      table.index(["supplyType", "supplyId"]);
      table.index(["legacyId"]);
    },
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("production_route_stage_supplies");
  await knex.schema.dropTableIfExists("production_route_stage_machines");
  await knex.schema.dropTableIfExists("production_route_stages");
  await knex.schema.dropTableIfExists("production_routes");
}
