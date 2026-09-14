import type { Knex } from "knex";

/**
 * Sprint 1.6 — customer field-parity gap-close (module 03, decision log §L.4/L.5).
 *
 * - code: Procusto Clientes.Codigo — FREE TEXT, manually entered (no
 *   autonumber, §L.4). UNIQUE(companyId, code) — NULLs exempt.
 * - dispatchable: `Despachable` — used on ALL live customers; gates dispatch
 *   filters (module 16). NULL→true semantics in Procusto → default true.
 * - notes (`Observaciones`), excludeLogoOnLabels (`ExcluirLogoEnCarteles`),
 *   requiresQualityCertificate (`RequiereCertificadoCalidad`).
 * - legacyId for ETL. legal_code stays as-is — it IS the CUIT target (§L.5).
 * Deprioritized (0-populated live): phone/email/salesperson/segmentation.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("customers", function (table) {
    table.string("code", 400);
    table.boolean("dispatchable").notNullable().defaultTo(true);
    table.text("notes");
    table.boolean("excludeLogoOnLabels").notNullable().defaultTo(false);
    table.boolean("requiresQualityCertificate").notNullable().defaultTo(false);
    table.integer("legacyId");

    table.unique(["companyId", "code"]);
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("customers", function (table) {
    table.dropUnique(["companyId", "code"]);
    table.dropIndex(["legacyId"]);
    table.dropColumn("code");
    table.dropColumn("dispatchable");
    table.dropColumn("notes");
    table.dropColumn("excludeLogoOnLabels");
    table.dropColumn("requiresQualityCertificate");
    table.dropColumn("legacyId");
  });
}
