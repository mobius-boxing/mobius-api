import type { Knex } from "knex";

/**
 * The customer's `address` is materialised as ONE flagged delivery location
 * per customer, so a pedido can point at it through the existing
 * `order_data.deliveryLocationId` FK (customer-address-delivery model.md,
 * D-2/D-3). Expand-only: the previous image ignores the column (default false).
 *
 * Backfill (D-8): an existing row whose address already equals the customer's
 * is flagged rather than duplicated; customers without such a row get one
 * (no zone — §L.6's zone requirement is for user-created rows, D-4).
 */
const AUDIT_CONTEXT = JSON.stringify({
  source: "migration",
  action: "delivery_locations.customer_address",
});

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("delivery_locations", "isCustomerAddress")) {
    return;
  }
  await knex.raw("select set_config('mobius.audit', ?, true)", [AUDIT_CONTEXT]);

  await knex.schema.alterTable("delivery_locations", (table) => {
    table.boolean("isCustomerAddress").notNullable().defaultTo(false);
  });
  await knex.raw(
    `CREATE UNIQUE INDEX delivery_locations_customer_address_uq
       ON delivery_locations ("customerId") WHERE "isCustomerAddress"`,
  );

  await knex.raw(`
    UPDATE delivery_locations dl
       SET "isCustomerAddress" = true
      FROM (
        SELECT DISTINCT ON (dl2."customerId") dl2.id
          FROM delivery_locations dl2
          JOIN customers c ON c.id = dl2."customerId"
         WHERE btrim(coalesce(c.address, '')) <> ''
           AND lower(btrim(coalesce(dl2.address, ''))) = lower(btrim(c.address))
         ORDER BY dl2."customerId", dl2."createdAt", dl2.id
      ) m
     WHERE dl.id = m.id
  `);

  await knex.raw(`
    INSERT INTO delivery_locations ("companyId", "customerId", address, "isCustomerAddress")
    SELECT c."companyId", c.id, btrim(c.address), true
      FROM customers c
     WHERE btrim(coalesce(c.address, '')) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM delivery_locations dl
          WHERE dl."customerId" = c.id AND dl."isCustomerAddress"
       )
  `);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
