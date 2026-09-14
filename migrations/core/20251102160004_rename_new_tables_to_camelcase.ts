import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Manufacturers
  await knex.schema.raw(
    'ALTER TABLE manufacturers RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE manufacturers RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Suppliers
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN supplies_sheets TO "suppliesSheets"',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN supplies_elaborated TO "suppliesElaborated"',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN supplies_consumables TO "suppliesConsumables"',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN supplies_paper TO "suppliesPaper"',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN supplies_tooling TO "suppliesTooling"',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Products
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN company_id TO "companyId"',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN client_code TO "clientCode"',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN customer_id TO "customerId"',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN updated_at TO "updatedAt"',
  );

  // Paper Supplies
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN company_id TO "companyId"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN manufacturer_id TO "manufacturerId"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN supplier_id TO "supplierId"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN minimum_stock TO "minimumStock"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN created_at TO "createdAt"',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN updated_at TO "updatedAt"',
  );
}

export async function down(knex: Knex): Promise<void> {
  // Manufacturers
  await knex.schema.raw(
    'ALTER TABLE manufacturers RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE manufacturers RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Suppliers
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "suppliesSheets" TO supplies_sheets',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "suppliesElaborated" TO supplies_elaborated',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "suppliesConsumables" TO supplies_consumables',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "suppliesPaper" TO supplies_paper',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "suppliesTooling" TO supplies_tooling',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE suppliers RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Products
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN "companyId" TO company_id',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN "clientCode" TO client_code',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN "customerId" TO customer_id',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE products RENAME COLUMN "updatedAt" TO updated_at',
  );

  // Paper Supplies
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN "companyId" TO company_id',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN "manufacturerId" TO manufacturer_id',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN "supplierId" TO supplier_id',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN "minimumStock" TO minimum_stock',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN "createdAt" TO created_at',
  );
  await knex.schema.raw(
    'ALTER TABLE paper_supplies RENAME COLUMN "updatedAt" TO updated_at',
  );
}
