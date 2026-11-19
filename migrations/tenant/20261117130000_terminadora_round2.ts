import type { Knex } from "knex";
import { applyRound2 } from "../../src/database/terminadora-schema";

/**
 * terminadora-order-flow round 2 (model-r2.md §Persistence). Expand-only:
 * `order_deliveries` created from scratch, two columns added to round-1 tables
 * that no deployed image reads yet. Core mirror:
 * `migrations/core/20261117130000_terminadora_round2.ts`.
 */
export async function up(knex: Knex): Promise<void> {
  await applyRound2(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
