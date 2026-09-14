import type { Knex } from "knex";

/**
 * Module 08 — `models` (Procusto `Modelos`), box-models spec §M1.
 *
 * PARITY (L-010): all 10 formula-bearing columns (8 scalar + 2 pipe-`|`
 * lists) are `text`, stored byte-for-byte as received — the formula engine
 * evaluates them in IEEE-754 doubles. This table has ZERO numeric/decimal
 * columns by design (AC-1); do not "clean up" formula text into numbers.
 *
 * `imageFileUuid` is a bare uuid handle (same shape as parts,
 * create_parts_tables.ts:120) — validated against `files` at write time.
 * `textsOnImage` is JSONB (D-5): array of {x, y, texto, campo}.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("models", function (table) {
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
    table.integer("legacyId"); // = Procusto Modelos.Id
    // Nullable at the column for a future ETL (D-2); the API requires it.
    table.string("code", 100);
    table.text("description").notNullable(); // Procusto Descripcion

    // Formula columns (text, verbatim — Procusto column in comment)
    table.text("sheetLengthFormula"); // LargoPlancha
    table.text("sheetWidthFormula"); // AnchoPlancha
    table.text("corrugationScoreLineFormulas"); // TrazadoresCorrugado (|-list)
    table.text("printScoreLineFormulas"); // TrazadoresImpresion (|-list)
    table.text("lowerFlapFormula"); // AletaInferior
    table.text("upperFlapFormula"); // AletaSuperior
    table.text("externalLengthDeltaFormula"); // DiferenciaLargoExterno
    table.text("externalWidthDeltaFormula"); // DiferenciaAnchoExterno
    table.text("externalHeightDeltaFormula"); // DiferenciaAlturaExterna
    table.text("boxSurfaceFormula"); // SuperficieCaja

    table.uuid("imageFileUuid"); // Imagen_Id → files.uuid handle
    table.jsonb("textsOnImage").notNullable().defaultTo("[]");

    table
      .integer("flapTypeId") // TipoDeAleta_Id
      .unsigned()
      .references("id")
      .inTable("flap_types")
      .onDelete("SET NULL");
    table
      .integer("complementId") // Complemento_Id
      .unsigned()
      .references("id")
      .inTable("complements")
      .onDelete("SET NULL");

    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["code", "companyId"]); // D-1: code unique per company
    table.index(["companyId"]);
    table.index(["legacyId"]);
    table.index(["flapTypeId"]);
    table.index(["complementId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("models");
}
