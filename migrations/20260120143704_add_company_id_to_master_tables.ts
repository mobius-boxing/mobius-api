import type { Knex } from "knex";

/**
 * Add company_id to master tables to enable multi-tenancy
 * Tables affected:
 * - paper_types
 * - flute_types
 * - paper_classes
 * - corrugation_classes
 * - corrugations
 * - manufacturers
 * - suppliers
 * - paper_sheets
 * - toolings
 * - consumable_supplies
 * - tooling_types
 * - consumable_types
 */

const TABLES_TO_UPDATE = [
  "paper_types",
  "flute_types",
  "paper_classes",
  "corrugation_classes",
  "corrugations",
  "manufacturers",
  "suppliers",
  "paper_sheets",
  "toolings",
  "consumable_supplies",
  "tooling_types",
  "consumable_types",
];

export async function up(knex: Knex): Promise<void> {
  // Get the first company to assign as default for existing records
  const firstCompany = await knex("companies").first();

  for (const tableName of TABLES_TO_UPDATE) {
    // Check if table exists before modifying
    const tableExists = await knex.schema.hasTable(tableName);
    if (!tableExists) {
      console.log(`Table ${tableName} does not exist, skipping...`);
      continue;
    }

    // Check if companyId column already exists
    const hasColumn = await knex.schema.hasColumn(tableName, "companyId");
    if (hasColumn) {
      console.log(`Table ${tableName} already has companyId column, skipping...`);
      continue;
    }

    // Add nullable companyId column first
    await knex.schema.alterTable(tableName, (table) => {
      table
        .integer("companyId")
        .nullable()
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
      table.index(["companyId"]);
    });

    // Update existing records with default company if one exists
    if (firstCompany) {
      await knex(tableName)
        .whereNull("companyId")
        .update({ companyId: firstCompany.id });
    }

    // Make companyId not nullable
    await knex.schema.alterTable(tableName, (table) => {
      table.integer("companyId").notNullable().alter();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const tableName of TABLES_TO_UPDATE) {
    const tableExists = await knex.schema.hasTable(tableName);
    if (!tableExists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(tableName, "companyId");
    if (!hasColumn) {
      continue;
    }

    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn("companyId");
    });
  }
}
