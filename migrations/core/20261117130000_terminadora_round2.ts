import type { Knex } from "knex";
import { applyRound2 } from "../../src/database/terminadora-schema";

/**
 * Core mirror of `migrations/tenant/20261117130000_terminadora_round2` for
 * databases whose business tables are still live here (parked cores skip).
 */
export async function up(knex: Knex): Promise<void> {
  if (
    !(await knex.schema.hasTable("supplier_receipts")) ||
    !(await knex.schema.hasTable("sales_orders"))
  ) {
    console.log(
      "terminadora_round2: skipped — business tables are not live in this database",
    );
    return;
  }
  await applyRound2(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
