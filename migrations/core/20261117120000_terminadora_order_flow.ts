import type { Knex } from "knex";
import { up as upSchema } from "../../src/database/terminadora-schema";

/**
 * Core mirror of `migrations/tenant/20261117120000_terminadora_order_flow` for
 * databases whose business tables are still live here (shared-target locals,
 * scratch bootstraps — parked cores skip, same as the corrugator mirror).
 */
export async function up(knex: Knex): Promise<void> {
  if (
    !(await knex.schema.hasTable("machines")) ||
    !(await knex.schema.hasTable("production_orders"))
  ) {
    console.log(
      "terminadora_order_flow: skipped — business tables are not live in this database",
    );
    return;
  }
  await upSchema(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
