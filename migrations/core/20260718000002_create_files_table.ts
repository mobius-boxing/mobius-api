import type { Knex } from "knex";

/**
 * files — attachment metadata; bytes live in S3 (divergence D1 from Procusto's
 * `Archivos` blob table in the sibling `{catalog} - Archivos` database).
 * Spec: specs/replication/modules/01-system-and-cross-cutting/file-storage.md.
 * Consumers (parts, products, models, palletizations) reference files.uuid —
 * 1:1 with Procusto's ArchivoID guid on migration (kept in legacyId).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("files", function (table) {
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
    table.text("originalName").notNullable();
    table.text("description");
    table.text("storageKey").notNullable();
    table.text("contentType");
    table.bigInteger("sizeBytes");
    table.text("checksum");
    table
      .integer("uploadedBy")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.uuid("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("files");
}
