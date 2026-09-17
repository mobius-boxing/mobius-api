import type { Knex } from "knex";
import { repairQaDemoModelFormulas } from "../../src/database/qa-demo-model-formulas";

/**
 * Data-only (expand-safe): replaces the QA demo seed's unbindable model
 * formulas, which evaluate to a sheet length of 0 and block saving products.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw("select set_config('mobius.audit', ?, true)", [
    JSON.stringify({
      source: "migration",
      action: "models.repairQaDemoFormulas",
    }),
  ]);
  const repaired = await repairQaDemoModelFormulas(knex);
  console.log(JSON.stringify({ repairQaDemoModelFormulas: repaired }));
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
