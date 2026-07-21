import type { Knex } from "knex";

/**
 * Sprint 2.1 — pallet_types + palletizations (specs/parts/12-palletization.md,
 * dbml TiposDePallets/Palletizados).
 *
 * pallet_types carries the physical pallet dims from the real DDL
 * (Largo/Ancho/Peso/Altura) beyond the spec's minimal sketch.
 * Palletizado file refs: ArchivoTecnico was a free-text path in Procusto —
 * upgraded to technicalFileUuid → files.uuid per the spec's D-note; Imagen_id
 * maps 1:1 to imageFileUuid.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("pallet_types", function (table) {
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
    table.double("length");
    table.double("width");
    table.double("weight");
    table.double("height");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    table.index(["companyId"]);
  });

  await knex.schema.createTable("palletizations", function (table) {
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
    table.smallint("boxesPerPackage").notNullable().defaultTo(0);
    table.smallint("packagesPerLevel").notNullable().defaultTo(0);
    table.smallint("levelsPerPallet").notNullable().defaultTo(0);
    table.smallint("additionalPackages").notNullable().defaultTo(0);
    table.smallint("sheetsPerPallet").notNullable().defaultTo(0);
    table.double("maxPalletHeight"); // mm
    table.double("surface"); // m²
    table.string("stackingType", 100);
    table.text("observations");
    table
      .uuid("technicalFileUuid")
      .references("uuid")
      .inTable("files")
      .onDelete("SET NULL");
    table
      .uuid("imageFileUuid")
      .references("uuid")
      .inTable("files")
      .onDelete("SET NULL");
    table
      .integer("palletTypeId")
      .unsigned()
      .references("id")
      .inTable("pallet_types")
      .onDelete("SET NULL");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    table.index(["companyId"]);
    table.index(["palletTypeId"]);
    table.index(["legacyId"]);
  });

  await knex.raw(`
    ALTER TABLE palletizations
      ADD CONSTRAINT palletizations_nonneg_chk CHECK (
        "boxesPerPackage" >= 0 AND "packagesPerLevel" >= 0 AND
        "levelsPerPallet" >= 0 AND "additionalPackages" >= 0 AND
        "sheetsPerPallet" >= 0 AND
        ("maxPalletHeight" IS NULL OR "maxPalletHeight" > 0) AND
        ("surface" IS NULL OR "surface" > 0)
      )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("palletizations");
  await knex.schema.dropTableIfExists("pallet_types");
}
