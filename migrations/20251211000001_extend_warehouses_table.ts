import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("warehouses", function (table) {
    table.integer("grid_rows").notNullable().defaultTo(10);
    table.integer("grid_cols").notNullable().defaultTo(10);
    table.integer("company_id").nullable().references("id").inTable("companies").onDelete("CASCADE");

    table.index(["company_id"]);
  });

  // Update any existing warehouses to have default company_id (first company in DB)
  const firstCompany = await knex("companies").select("id").first();
  if (firstCompany) {
    await knex("warehouses")
      .whereNull("company_id")
      .update({ company_id: firstCompany.id });
  }

  // Now make company_id not nullable
  await knex.schema.alterTable("warehouses", function (table) {
    table.integer("company_id").notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("warehouses", function (table) {
    table.dropColumn("grid_rows");
    table.dropColumn("grid_cols");
    table.dropColumn("company_id");
  });
}
