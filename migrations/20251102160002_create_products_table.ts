import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("products", function (table) {
    table.increments("id").primary();
    table.uuid("uuid").unique().notNullable().defaultTo(knex.raw("gen_random_uuid()"));
    table.integer("company_id").notNullable().references("id").inTable("companies").onDelete("CASCADE");
    table.string("code", 100).notNullable();
    table.string("client_code", 100);
    table.text("description");
    table.integer("customer_id").notNullable().references("id").inTable("customers").onDelete("RESTRICT");
    table.timestamps(true, true);

    table.unique(["company_id", "code"]); // Ensure unique codes per company
    table.index(["company_id"]);
    table.index(["customer_id"]);
    table.index(["code"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("products");
}
