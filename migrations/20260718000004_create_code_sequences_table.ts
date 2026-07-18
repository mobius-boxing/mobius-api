import type { Knex } from "knex";

/**
 * code_sequences — concurrency-safe counters behind CodeGeneratorService
 * (Procusto autonumerador replacement, divergence D7: row lock instead of the
 * racy O(n) max-scan). One row per (company, scope, parentKey):
 *   scope 'production-order' parentKey null      → global 8-digit fallback
 *   scope 'production-order' parentKey '00014091'→ per-pedido "\n" suffix
 *   scope 'coil'             parentKey null      → 10-digit
 * Migration seeding rule: import legacy codes verbatim, seed lastValue to
 * MAX(existing numeric value/suffix) — never regenerate.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("code_sequences", function (table) {
    table.increments("id").primary();
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("scope", 100).notNullable();
    // '' = no parent (global sequence). NOT NULL so the plain unique constraint
    // covers both cases and INSERT … ON CONFLICT can target it atomically.
    table.string("parentKey", 200).notNullable().defaultTo("");
    table.bigInteger("lastValue").notNullable().defaultTo(0);
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "scope", "parentKey"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("code_sequences");
}
