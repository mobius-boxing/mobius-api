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
    table.string("parentKey", 200);
    table.bigInteger("lastValue").notNullable().defaultTo(0);
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    // Postgres treats NULLs as distinct in unique constraints; coalesce via two
    // partial indexes so (company, scope) is unique with and without a parent.
    table.index(["companyId", "scope"]);
  });
  await knex.raw(
    `CREATE UNIQUE INDEX code_sequences_scope_parent_uq
       ON code_sequences ("companyId", scope, "parentKey") WHERE "parentKey" IS NOT NULL`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX code_sequences_scope_uq
       ON code_sequences ("companyId", scope) WHERE "parentKey" IS NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("code_sequences");
}
