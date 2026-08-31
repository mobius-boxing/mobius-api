import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("sheet_stock", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));

    // Foreign keys
    table
      .integer("warehouseId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("warehouses")
      .onDelete("CASCADE");
    table
      .integer("warehouseLocationId")
      .unsigned()
      .references("id")
      .inTable("warehouse_locations")
      .onDelete("SET NULL");
    table
      .integer("supplierId")
      .unsigned()
      .references("id")
      .inTable("suppliers")
      .onDelete("SET NULL");
    table
      .integer("manufacturerId")
      .unsigned()
      .references("id")
      .inTable("manufacturers")
      .onDelete("SET NULL");
    table
      .integer("paperSheetId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("paper_sheets")
      .onDelete("CASCADE");

    // Data columns
    table.text("comments");
    table.decimal("price", 10, 2);
    table.integer("quantity").notNullable().defaultTo(0);

    // Timestamps (will be renamed to camelCase)
    table.timestamps(true, true);

    // Indexes
    table.index(["warehouseId"]);
    table.index(["paperSheetId"]);
    table.index(["supplierId"]);
    table.index(["manufacturerId"]);
  });

  // Rename timestamps to camelCase
  await knex.schema.raw(
    'ALTER TABLE sheet_stock RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE sheet_stock RENAME COLUMN updated_at TO "updatedAt"',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("sheet_stock");
}
