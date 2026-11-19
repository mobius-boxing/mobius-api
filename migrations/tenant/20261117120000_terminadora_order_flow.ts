import type { Knex } from "knex";
import { up as upSchema } from "../../src/database/terminadora-schema";

/**
 * terminadora-order-flow (model.md §Persistence). Expand-only: two additive
 * columns, one index, five tables created from scratch and the idempotent
 * `isSupplier` backfill — the previous image never reads any of it. Core
 * mirror: `migrations/core/20261117120000_terminadora_order_flow.ts`.
 */
export async function up(knex: Knex): Promise<void> {
  await upSchema(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
