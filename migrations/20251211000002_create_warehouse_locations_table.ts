import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("warehouse_locations", function (table) {
    table.increments("id").primary();
    table.uuid("uuid").unique().notNullable().defaultTo(knex.raw("gen_random_uuid()"));
    table.integer("warehouse_id").notNullable().references("id").inTable("warehouses").onDelete("CASCADE");
    table.integer("row").notNullable(); // 0-indexed row position
    table.integer("col").notNullable(); // 0-indexed column position
    table.string("status", 20).notNullable().defaultTo("active"); // 'active' or 'inactive'
    table.string("location_type", 50).notNullable().defaultTo("storage"); // 'storage', 'receiving', 'shipping', 'quarantine', 'wip'
    table.string("location_code", 50); // Human-readable code like 'A-05', 'B-12'
    table.jsonb("capacity"); // {maxWeight: 5000, maxVolume: 100, maxPallets: 4, unit: 'kg'}
    table.jsonb("metadata"); // Flexible storage for custom properties
    table.timestamps(true, true);

    table.unique(["warehouse_id", "row", "col"]); // One location per grid cell
    table.index(["warehouse_id"]);
    table.index(["location_type"]);
    table.index(["status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("warehouse_locations");
}
