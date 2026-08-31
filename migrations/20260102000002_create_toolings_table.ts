import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("toolings", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable();
    table.text("description");
    table.integer("manufacturerId").unsigned().nullable();
    table.integer("supplierId").unsigned().nullable();
    table.integer("minimumStock").defaultTo(0);
    table.integer("toolingTypeId").unsigned().notNullable();
    table.timestamps(true, true);

    // Foreign keys
    table
      .foreign("manufacturerId")
      .references("id")
      .inTable("manufacturers")
      .onDelete("SET NULL");
    table
      .foreign("supplierId")
      .references("id")
      .inTable("suppliers")
      .onDelete("SET NULL");
    table
      .foreign("toolingTypeId")
      .references("id")
      .inTable("tooling_types")
      .onDelete("RESTRICT");

    // Indexes
    table.index(["manufacturerId"]);
    table.index(["supplierId"]);
    table.index(["toolingTypeId"]);
    table.index(["name"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("toolings");
}
