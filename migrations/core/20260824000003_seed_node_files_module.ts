import type { Knex } from "knex";

/**
 * Register `node-files` in the module catalogue — this is the row the backoffice
 * company-modules modal reads, so the toggle appears the moment this runs.
 *
 * No company_modules backfill: like countdown, the module is opt-in and gets
 * enabled per company from the backoffice. ON CONFLICT on the unique (slug)
 * makes it idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `INSERT INTO modules (slug, name, description, "isCore")
     VALUES ('node-files', 'Node Files',
             'Extracción de datos de documentos con IA: definí un flujo con los campos a extraer, subí el documento y revisá los valores obtenidos.',
             false)
     ON CONFLICT (slug) DO NOTHING`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DELETE FROM company_modules
      WHERE "moduleId" IN (SELECT id FROM modules WHERE slug = 'node-files')`,
  );
  await knex.raw(`DELETE FROM modules WHERE slug = 'node-files'`);
}
