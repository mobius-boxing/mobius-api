import type { Knex } from "knex";

/**
 * Add legal_code column to customers table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("customers", function (table) {
    table.string("legal_code").after("legalName");
  });
}

/**
 * Rollback: Remove legal_code column from customers table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("customers", function (table) {
    table.dropColumn("legal_code");
  });
}
