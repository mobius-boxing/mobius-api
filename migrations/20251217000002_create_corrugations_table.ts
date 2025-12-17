import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("corrugations", function (table) {
    table.increments("id").primary();
    table.uuid("uuid").unique().notNullable().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code", 50).notNullable().unique();
    table.text("description");
    table.decimal("theoreticalGrammage", 10, 2);
    table.decimal("suggestedWidth", 10, 2);
    table.decimal("caliper", 10, 4);
    table.integer("corrugationClassId").unsigned()
      .references("id").inTable("corrugation_classes").onDelete("SET NULL");
    table.timestamps(true, true);

    table.index(["code"]);
    table.index(["corrugationClassId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("corrugations");
}
