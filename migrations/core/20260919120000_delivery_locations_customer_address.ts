import type { Knex } from "knex";
import { up as tenantUp } from "../tenant/20260919120000_delivery_locations_customer_address";

/**
 * Core mirror of `migrations/tenant/20260919120000_delivery_locations_customer_address`
 * for databases whose business tables are still live here (shared-target
 * rows are migrated by the core step); parked cores skip.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("delivery_locations"))) {
    console.log(
      "delivery_locations_customer_address: skipped — business tables are not live in this database",
    );
    return;
  }
  await tenantUp(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
