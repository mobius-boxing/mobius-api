import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Seed the two known modules. ON CONFLICT on the unique (slug) makes this idempotent.
  await knex.raw(
    `INSERT INTO modules (slug, name, description, "isCore")
     VALUES
       ('core',  'Core',  'Main Mobius application — always enabled for every company.', true),
       ('store', 'Store', 'B2B e-commerce storefront for company customers.',             false)
     ON CONFLICT (slug) DO NOTHING`,
  );

  // Backfill: every existing company gets a company_modules row for 'core',
  // enabled, complimentary. Idempotent via the (companyId, moduleId) unique.
  await knex.raw(
    `INSERT INTO company_modules
       ("companyId", "moduleId", enabled, "enabledAt", "subscriptionStatus")
     SELECT c.id, m.id, true, NOW(), 'comp'
       FROM companies c
       CROSS JOIN modules m
      WHERE m.slug = 'core'
     ON CONFLICT ("companyId", "moduleId") DO NOTHING`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Undo the backfill links first (FK RESTRICT), then the seed.
  await knex.raw(
    `DELETE FROM company_modules
      WHERE "moduleId" IN (SELECT id FROM modules WHERE slug IN ('core','store'))`,
  );
  await knex.raw(`DELETE FROM modules WHERE slug IN ('core','store')`);
}
