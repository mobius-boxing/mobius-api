import type { Knex } from "knex";

/**
 * finished_goods — Procusto `Insumos_DBProductoElaborado` (module 09; 1,697
 * live rows make it load-bearing — decision log §I / tldr 09 Q2).
 *
 * partId/stageId are the Procusto Parte_Id (NOT NULL there) and Etapa_Id;
 * both ship NULLABLE as the Q-09-3 interim until modules 07 (parts) and 12
 * (route stages) land, then partId tightens to NOT NULL.
 * minimumStock is the base Insumo StockMinimo (unit count for this subtype).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("finished_goods", function (table) {
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
    table.string("name", 400).notNullable();
    table.text("description");
    table
      .integer("supplierId")
      .unsigned()
      .references("id")
      .inTable("suppliers")
      .onDelete("SET NULL");
    table
      .integer("manufacturerId")
      .unsigned()
      .references("id")
      .inTable("manufacturers")
      .onDelete("SET NULL");
    // Interim nullable FKs (Q-09-3): real targets arrive with modules 07/12.
    table.integer("partId");
    table.integer("stageId");
    table.decimal("minimumStock", 14, 4);
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["code"]);
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("finished_goods");
}
