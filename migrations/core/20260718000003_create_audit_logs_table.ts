import type { Knex } from "knex";

/**
 * audit_logs — per-entity JSON change snapshots (Procusto `LogCambios` replacement,
 * spec: modules/01-system-and-cross-cutting/audit-log.md).
 *
 * Divergences (decided): jsonb snapshot instead of varchar JSON string (D5);
 * server-side UTC occurredAt (D6); and — per the 2026-07-18 decision — the log is
 * wired generically into BaseCrudController so history covers almost every entity,
 * not just Procusto's four (Cliente/Parte/Producto/OrdenDeProduccion).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_logs", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("entityName", 100).notNullable();
    table.integer("entityLegacyId");
    table.uuid("entityUuid");
    table.text("entityCode");
    table.text("entityDescription");
    table.enu("operation", ["Alta", "Baja", "Modificacion"]).notNullable();
    table.text("username");
    table
      .integer("userId")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.jsonb("snapshot");
    table
      .timestamp("occurredAt", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());

    // Drives the per-record history viewer.
    table.index(["companyId", "entityName", "entityUuid", "occurredAt"]);
    table.index(["companyId", "occurredAt"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("audit_logs");
}
