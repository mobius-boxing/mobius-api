import type { Knex } from "knex";

/**
 * Machines-lite (module 14 minimal slice) — just enough for production routes
 * (stages reference machine_types; participants reference machines). Capacity
 * math (CapacidadesPorCorrugado, curves, scheduler durations) stays module 13/14.
 *
 * machine_types ← TiposDeMaquina (full shape — the flags matter to routes/parts:
 * `corrugated` marks corrugator stages, requiresDie/requiresPlate gate tooling).
 * machines ← Maquinas base (TPH subtypes flattened as nullable columns:
 * linearMeters for Corrugadora; box min/max bounds for Conversora).
 * Procusto's DepositoOrigen/Destino are NOT NULL; nullable here until warehouse
 * assignment is part of the flow (ETL fills them).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("machine_types", function (table) {
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
    table.smallint("location");
    table.boolean("requiresDie").notNullable().defaultTo(false);
    table.boolean("requiresPlate").notNullable().defaultTo(false);
    table.string("attribute", 400);
    table.boolean("corrugated").notNullable().defaultTo(false);
    table.boolean("generatesSheets");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"]);
    table.index(["companyId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable("machines", function (table) {
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
    table
      .integer("machineTypeId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("machine_types")
      .onDelete("RESTRICT");
    table.decimal("sheetWidthMin", 12, 3);
    table.decimal("sheetLengthMin", 12, 3);
    table.decimal("sheetWidthMax", 12, 3);
    table.decimal("sheetLengthMax", 12, 3);
    table.decimal("width", 12, 3);
    table.decimal("setupTime", 12, 3).notNullable().defaultTo(0);
    table.decimal("maxScoreLines", 12, 3);
    table
      .integer("sourceWarehouseId")
      .unsigned()
      .references("id")
      .inTable("warehouses")
      .onDelete("SET NULL");
    table
      .integer("destinationWarehouseId")
      .unsigned()
      .references("id")
      .inTable("warehouses")
      .onDelete("SET NULL");
    // Corrugadora subtype (flattened)
    table.decimal("linearMeters", 12, 3);
    // Conversora subtype (flattened)
    table.decimal("boxWidthMin", 12, 3);
    table.decimal("boxWidthMax", 12, 3);
    table.decimal("boxLengthMin", 12, 3);
    table.decimal("boxLengthMax", 12, 3);
    table.decimal("boxHeightMin", 12, 3);
    table.decimal("boxHeightMax", 12, 3);
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    table.index(["companyId"]);
    table.index(["machineTypeId"]);
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("machines");
  await knex.schema.dropTableIfExists("machine_types");
}
