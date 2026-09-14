import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("store_order_items", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("orderId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("store_orders")
      .onDelete("CASCADE");

    // 'box' | 'roll' — validated at TS level (no DB CHECK / enum).
    table.text("itemType").notNullable();

    // Soft reference to the store_box / store_roll uuid at order time.
    // NOT a FK and nullable: deleting a catalog item must not break order history.
    table.uuid("sourceUuid").nullable();

    // SNAPSHOT of the catalog description at order time.
    table.text("description").notNullable();

    table.integer("quantity").unsigned().notNullable();

    // SNAPSHOT of unitsPerPallet for boxes (pallet-math display/audit). NULL for rolls.
    table.integer("unitsPerPallet").unsigned().nullable();

    // Single timestamp — items are immutable once the order is placed.
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());

    table.index(["orderId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("store_order_items");
}
