import type { Knex } from "knex";

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("paper_supplies");
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("paper_supplies", function (table) {
    table.increments("id").primary();
    table.uuid("uuid").unique().notNullable().defaultTo(knex.raw("gen_random_uuid()"));
    table.integer("company_id").notNullable().references("id").inTable("companies").onDelete("CASCADE");
    table.string("code", 100).notNullable();
    table.text("description");
    table.string("name", 255).notNullable();
    table.integer("manufacturer_id").references("id").inTable("manufacturers").onDelete("RESTRICT");
    table.integer("supplier_id").references("id").inTable("suppliers").onDelete("RESTRICT");
    table.jsonb("minimum_stock"); // {pallets: number, boxes: number}
    table.timestamps(true, true);

    table.unique(["company_id", "code"]); // Ensure unique codes per company
    table.index(["company_id"]);
    table.index(["manufacturer_id"]);
    table.index(["supplier_id"]);
    table.index(["code"]);
  });
}
