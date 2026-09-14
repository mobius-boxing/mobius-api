import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("store_orders", function (table) {
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
    table
      .integer("storeUserId")
      .unsigned()
      .nullable() // keep order history if the store user is later deleted
      .references("id")
      .inTable("store_users")
      .onDelete("SET NULL");

    // v1: only 'submitted'. Future: processing / fulfilled / cancelled.
    // Status validated at TS level — no DB CHECK / enum (matches project convention).
    table.text("status").notNullable().defaultTo("submitted");
    table.text("notes").nullable(); // optional customer note

    // Timestamps (camelCase) — match store_boxes / store_rolls style.
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["storeUserId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("store_orders");
}
