import type { Knex } from "knex";

/**
 * Sprint 1.1 — supply-table schema repairs (decision log §L, modules 05/09).
 *
 * - legacyId on all four supply tables (ETL FK remapping — 02-data-migration).
 * - paper_supplies.minimumStock: corrective shape change. Procusto paper
 *   StockMinimo is a CantidadBobina {Peso kg, Diametro mm} (§L.3, source-
 *   verified); the shipped {pallets, boxes} shape was wrong. Existing non-null
 *   values are preserved under a `legacy` key rather than dropped.
 * - paper_supplies.color: Procusto Papel.Color is free text (tph-map §B).
 * - consumable_supplies: add location (Ubicacion, free text), expiry
 *   (Vencimiento — FREE TEXT by design, live data holds strings like
 *   "15-07-22"; Q-09-8), minimumStock (stock units).
 * - toolings.code: Procusto Herramental carries an autonumbered Codigo; column
 *   added now, CodeGenerator wiring lands when the numbering format is pinned.
 *
 * companyId already exists on all four (added 20260120143704) — the spec's
 * "3 of 4 missing companyId" claim was outdated.
 */
export async function up(knex: Knex): Promise<void> {
  for (const tableName of [
    "paper_supplies",
    "paper_sheets",
    "consumable_supplies",
    "toolings",
  ]) {
    await knex.schema.alterTable(tableName, function (table) {
      table.integer("legacyId");
      table.index(["legacyId"]);
    });
  }

  await knex.schema.alterTable("paper_supplies", function (table) {
    table.text("color");
  });
  await knex.raw(`
    UPDATE paper_supplies
       SET "minimumStock" = jsonb_build_object(
             'weightKg', NULL,
             'diameterMm', NULL,
             'legacy', "minimumStock"
           )
     WHERE "minimumStock" IS NOT NULL
  `);

  await knex.schema.alterTable("consumable_supplies", function (table) {
    table.text("location");
    table.text("expiry");
    table.decimal("minimumStock", 14, 4);
  });

  await knex.schema.alterTable("toolings", function (table) {
    table.string("code", 400);
    table.index(["code"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("toolings", function (table) {
    table.dropIndex(["code"]);
    table.dropColumn("code");
  });
  await knex.schema.alterTable("consumable_supplies", function (table) {
    table.dropColumn("location");
    table.dropColumn("expiry");
    table.dropColumn("minimumStock");
  });
  await knex.raw(`
    UPDATE paper_supplies
       SET "minimumStock" = "minimumStock"->'legacy'
     WHERE jsonb_exists("minimumStock", 'legacy')
  `);
  await knex.schema.alterTable("paper_supplies", function (table) {
    table.dropColumn("color");
  });
  for (const tableName of [
    "toolings",
    "consumable_supplies",
    "paper_sheets",
    "paper_supplies",
  ]) {
    await knex.schema.alterTable(tableName, function (table) {
      table.dropIndex(["legacyId"]);
      table.dropColumn("legacyId");
    });
  }
}
