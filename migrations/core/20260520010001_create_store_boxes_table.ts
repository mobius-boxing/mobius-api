import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("store_boxes", function (table) {
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
    table.text("description").notNullable();
    table.integer("unitsPerPackage").unsigned().notNullable();
    table.integer("unitsPerPallet").unsigned().notNullable();
    table.boolean("isActive").notNullable().defaultTo(true);

    // Timestamps (camelCase)
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.index(["companyId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("store_boxes");
}
