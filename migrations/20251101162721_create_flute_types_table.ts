import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("flute_types", function (table) {
    table.increments("id").primary();
    table.uuid("uuid").unique().notNullable().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code", 50).notNullable().unique();
    table.text("description");
    table.decimal("flue_factor");
    table.decimal("length");
    table.decimal("width");
    table.decimal("height");
    table.timestamps(true, true);

    table.index(["code"]);
  });
}


export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("flute_types");
}
