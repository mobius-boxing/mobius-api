import type { Knex } from "knex";

/**
 * Create customers table
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("customers", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("company_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("supplier_code");
    table
      .integer("sales_person_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table
      .integer("category_id")
      .unsigned()
      .references("id")
      .inTable("customer_categories")
      .onDelete("SET NULL");
    table.boolean("active").defaultTo(true);
    table.string("legal_name");
    table.text("address");
    table.string("trade_name");
    table.jsonb("contacts").defaultTo("[]");
    table.jsonb("delivery_locations").defaultTo("[]");
    table.jsonb("delivery_days").defaultTo("[]");
    table.timestamps(true, true);

    // Indexes for performance
    table.index(["company_id"]);
    table.index(["sales_person_id"]);
    table.index(["category_id"]);
    table.index(["active"]);
    table.index(["name"]);
    table.index(["supplier_code"]);
    table.unique(["company_id", "uuid"]);
  });
}

/**
 * Rollback: Drop customers table
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("customers");
}
