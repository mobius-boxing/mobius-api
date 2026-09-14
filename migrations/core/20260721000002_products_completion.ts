import type { Knex } from "knex";

/**
 * Sprint 2.2 — products completion (module 06 01-entities / 04-state-and-lifecycle).
 *
 * - 4 file refs (Ficha/Plano/Boceto/Imagen → files.uuid), unblocked by the
 *   Phase 0 file infrastructure.
 * - Product approval pair: AprobacionProducto/Usuario + CancelacionProducto/
 *   Usuario semantics — approve sets approval and CLEARS cancellation, cancel
 *   does the reverse; user is a denormalized username snapshot (survives user
 *   deletion). Pending = both timestamps NULL.
 * - legacyId for ETL.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", function (table) {
    table
      .uuid("technicalSheetFileUuid")
      .references("uuid")
      .inTable("files")
      .onDelete("SET NULL");
    table
      .uuid("blueprintFileUuid")
      .references("uuid")
      .inTable("files")
      .onDelete("SET NULL");
    table
      .uuid("sketchFileUuid")
      .references("uuid")
      .inTable("files")
      .onDelete("SET NULL");
    table
      .uuid("imageFileUuid")
      .references("uuid")
      .inTable("files")
      .onDelete("SET NULL");
    table.timestamp("productApprovalAt", { useTz: true });
    table.text("productApprovalBy");
    table.timestamp("productCancellationAt", { useTz: true });
    table.text("productCancellationBy");
    table.integer("legacyId");
    table.index(["legacyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", function (table) {
    table.dropIndex(["legacyId"]);
    table.dropColumn("technicalSheetFileUuid");
    table.dropColumn("blueprintFileUuid");
    table.dropColumn("sketchFileUuid");
    table.dropColumn("imageFileUuid");
    table.dropColumn("productApprovalAt");
    table.dropColumn("productApprovalBy");
    table.dropColumn("productCancellationAt");
    table.dropColumn("productCancellationBy");
    table.dropColumn("legacyId");
  });
}
