import type { Knex } from "knex";

/**
 * `companies` is core-only (ownership.ts), so there is no tenant mirror. The
 * trigger is what makes `product` immutable for every writer, not just the DAO.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("companies", "product"))) {
    await knex.schema.alterTable("companies", (table) => {
      table.text("product").notNullable().defaultTo("full");
    });
  }

  await knex.raw(`
    ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_product_check
  `);
  await knex.raw(`
    ALTER TABLE companies
      ADD CONSTRAINT companies_product_check CHECK (product IN ('full', 'lite'))
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION companies_product_immutable() RETURNS trigger AS $$
    BEGIN
      IF OLD.product IS DISTINCT FROM NEW.product THEN
        RAISE EXCEPTION 'companies.product is immutable (% -> %)', OLD.product, NEW.product
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(
    `DROP TRIGGER IF EXISTS companies_product_immutable ON companies`,
  );
  await knex.raw(`
    CREATE TRIGGER companies_product_immutable
      BEFORE UPDATE OF product ON companies
      FOR EACH ROW EXECUTE FUNCTION companies_product_immutable()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DROP TRIGGER IF EXISTS companies_product_immutable ON companies`,
  );
  await knex.raw(`DROP FUNCTION IF EXISTS companies_product_immutable()`);
  await knex.raw(
    `ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_product_check`,
  );
  if (await knex.schema.hasColumn("companies", "product")) {
    await knex.schema.alterTable("companies", (table) => {
      table.dropColumn("product");
    });
  }
}
