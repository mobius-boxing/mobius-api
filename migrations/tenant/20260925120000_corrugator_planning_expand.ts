import type { Knex } from "knex";
import { up as upSchema } from "../../src/database/corrugator-planning-schema";

/**
 * corrugator-planning ("Programa de corrugado"), tier 1 (model.md +
 * Amendments). Expand-only: `machines` gains six `DEFAULT 0` columns and four
 * tables are created from scratch — nothing here can break the previous
 * image, which simply never reads them. Core mirror:
 * `migrations/core/20260925120000_corrugator_planning_expand.ts`.
 */
export async function up(knex: Knex): Promise<void> {
  await upSchema(knex);
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
