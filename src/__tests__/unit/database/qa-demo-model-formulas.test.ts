import { describe, it, expect } from "@jest/globals";
import { QA_DEMO_MODEL_FORMULAS } from "../../../database/qa-demo-model-formulas";
import { validate, validateList } from "../../../services/formula-engine";

const LIST_KEYS = new Set([
  "corrugationScoreLineFormulas",
  "printScoreLineFormulas",
]);

describe("QA demo model formulas (fefco-sheet-calculation verify)", () => {
  it.each(Object.entries(QA_DEMO_MODEL_FORMULAS))(
    "%s validates under the formula engine",
    (key, formula) => {
      const result = LIST_KEYS.has(key)
        ? validateList(formula)
        : validate(formula);
      expect(result.ok).toBe(true);
    },
  );

  it("gives a positive sheet length and width on the design-time fixture", () => {
    const length = validate(QA_DEMO_MODEL_FORMULAS.sheetLengthFormula);
    const width = validate(QA_DEMO_MODEL_FORMULAS.sheetWidthFormula);
    expect(length.ok && length.value).toBeGreaterThan(0);
    expect(width.ok && width.value).toBeGreaterThan(0);
  });

  it("the broken seed formula it replaces evaluates to nothing usable", () => {
    expect(validate("2*(Largo+Ancho)+Pestania").ok).toBe(false);
  });
});
