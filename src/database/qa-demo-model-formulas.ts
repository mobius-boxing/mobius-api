/**
 * The QA demo seed (seeds/core/002_qa_demo_co.ts) originally stored model
 * formulas with parameter names the formula engine does not bind (`Pestania`,
 * `Alto`, `Solapa`, `Espesor`) and `;` instead of `|` list separators. The
 * engine evaluates such a formula to 0, so every seeded model produced a
 * sheet length of 0 and the product could no longer be saved
 * (fefco-sheet-calculation verify.md). These are real-corpus FEFCO 0201
 * formulas that validate.
 */
import type { Knex } from "knex";

export const QA_DEMO_MODEL_FORMULAS = {
  sheetLengthFormula: "2*([Largo externo]+[Base externa]+[t])+[Chapeton]",
  sheetWidthFormula: "[Base externa]+[Base externa]+[Altura externa]+[t]",
  corrugationScoreLineFormulas:
    "Truncate([Ancho externo]/2)|[Altura externa]|Ceiling([Ancho externo]/2)",
  printScoreLineFormulas:
    "[Chapeton]|[Base externa]|[Largo externo]|[Base externa]|[Largo externo]",
  lowerFlapFormula: "Truncate([Base externa]*57.21/100)",
  upperFlapFormula: "Ceiling([Base externa]/2)",
  externalLengthDeltaFormula: "5",
  externalWidthDeltaFormula: "5",
  externalHeightDeltaFormula: "5",
  boxSurfaceFormula:
    "(2*([Largo externo]+[Base externa]+[t])+[Chapeton])*([Base externa]+[Altura externa]+[t])/1000000",
} as const;

const BROKEN_SEED_SHEET_LENGTH = "2*(Largo+Ancho)+Pestania";

/** Rewrites only rows still carrying the broken seed formulas; idempotent. */
export async function repairQaDemoModelFormulas(knex: Knex): Promise<number> {
  if (!(await knex.schema.hasTable("models"))) return 0;
  return knex("models")
    .where("sheetLengthFormula", BROKEN_SEED_SHEET_LENGTH)
    .update({ ...QA_DEMO_MODEL_FORMULAS, updatedAt: knex.fn.now() });
}
