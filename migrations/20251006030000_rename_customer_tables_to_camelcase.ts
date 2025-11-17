import type { Knex } from "knex";

/**
 * Rename customer_categories and customers columns from snake_case to camelCase
 */
export async function up(knex: Knex): Promise<void> {
  // Rename customer_categories columns
  await knex.schema.raw(
    'ALTER TABLE customer_categories RENAME COLUMN company_id TO "companyId"',
  );
  await knex.schema.raw(
    'ALTER TABLE customer_categories RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE customer_categories RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Rename customers columns
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN company_id TO "companyId"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN sales_person_id TO "salesPersonId"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN category_id TO "categoryId"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN legal_name TO "legalName"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN trade_name TO "tradeName"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN delivery_locations TO "deliveryLocations"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN delivery_days TO "deliveryDays"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN updated_at TO "updatedAt"',
  );
}

/**
 * Rollback: Rename columns from camelCase to snake_case
 */
export async function down(knex: Knex): Promise<void> {
  // Rollback customer_categories columns
  await knex.schema.raw(
    'ALTER TABLE customer_categories RENAME COLUMN "companyId" TO company_id',
  );
  await knex.schema.raw(
    'ALTER TABLE customer_categories RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE customer_categories RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Rollback customers columns
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "companyId" TO company_id',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "salesPersonId" TO sales_person_id',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "categoryId" TO category_id',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "legalName" TO legal_name',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "tradeName" TO trade_name',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "deliveryLocations" TO delivery_locations',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "deliveryDays" TO delivery_days',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE customers RENAME COLUMN "updatedAt" TO updated_at',
  );
}
