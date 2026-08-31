import type { Knex } from "knex";

/**
 * Create tooling_stock table
 * Stock entity for tooling inventory in warehouses
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tooling_stock", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));

    // Warehouse location
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

    // Supply chain info
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

    // Related tooling entity
    table
      .integer("toolingId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("toolings")
      .onDelete("CASCADE");

    // Stock details
    table.text("comments");
    table.decimal("price", 10, 2);
    table.integer("quantity").notNullable().defaultTo(0);

    table.timestamp("createdAt").defaultTo(knex.fn.now());
    table.timestamp("updatedAt").defaultTo(knex.fn.now());

    table.index(["warehouseId"]);
    table.index(["warehouseLocationId"]);
    table.index(["supplierId"]);
    table.index(["manufacturerId"]);
    table.index(["toolingId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("tooling_stock");
}
