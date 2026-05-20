import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("company_modules", function (table) {
    table.increments("id").primary();

    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");

    table
      .integer("moduleId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("modules")
      .onDelete("RESTRICT");

    // Enablement
    table.boolean("enabled").notNullable().defaultTo(true);
    table.timestamp("enabledAt").notNullable().defaultTo(knex.fn.now());
    table
      .integer("enabledBy")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.timestamp("disabledAt").nullable();
    table
      .integer("disabledBy")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    // Per-module configuration (forward-compat)
    table.jsonb("config").notNullable().defaultTo(knex.raw("'{}'::jsonb"));

    // Subscription / billing metadata (forward-compat)
    table.text("subscriptionStatus").notNullable().defaultTo("comp");
    table.timestamp("trialStartsAt").nullable();
    table.timestamp("trialEndsAt").nullable();
    table.timestamp("currentPeriodStartsAt").nullable();
    table.timestamp("currentPeriodEndsAt").nullable();
    table.timestamp("canceledAt").nullable();
    table.text("externalSubscriptionId").nullable();

    // Timestamps (camelCase)
    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").notNullable().defaultTo(knex.fn.now());

    table.unique(["companyId", "moduleId"]);
  });

  // Partial index: speeds up "what modules does this company have enabled right now".
  await knex.schema.raw(
    `CREATE INDEX idx_company_modules_company_enabled
       ON company_modules ("companyId")
       WHERE enabled = true`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Index is dropped automatically when the table is dropped, but be explicit
  // in case the table-drop is ever skipped.
  await knex.schema.raw(
    `DROP INDEX IF EXISTS idx_company_modules_company_enabled`,
  );
  await knex.schema.dropTable("company_modules");
}
