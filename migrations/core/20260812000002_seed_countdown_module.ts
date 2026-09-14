import type { Knex } from "knex";

/**
 * Register `countdown` in the module catalogue. No company_modules backfill:
 * unlike `core`, this module is opt-in and gets enabled per company from the
 * backoffice. ON CONFLICT on the unique (slug) makes it idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `INSERT INTO modules (slug, name, description, "isCore")
     VALUES ('countdown', 'Countdown',
             'Seguimiento de vencimientos de documentos: alta con fecha de vencimiento, tablero de pendientes y vencidos, recordatorios por email y exportación a Excel.',
             false)
     ON CONFLICT (slug) DO NOTHING`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DELETE FROM company_modules
      WHERE "moduleId" IN (SELECT id FROM modules WHERE slug = 'countdown')`,
  );
  await knex.raw(`DELETE FROM modules WHERE slug = 'countdown'`);
}
