/**
 * Formula engine shape/robustness suite — AC-6, AC-7, AC-8, AC-18.
 * Numeric parity cases live in golden.spec.ts (driven by golden-cases.json).
 */
import {
  FORMULA_PARAMETERS,
  TESTEAR_FIXTURE,
  evaluate,
  evaluateList,
  validate,
  validateList,
} from "../index";

describe("FORMULA_PARAMETERS (AC-6)", () => {
  it("is the 34 names, in order, byte-for-byte", () => {
    // PARITY (L-010): verbatim NCalc binding keys — spacing/casing/no accents.
    expect(FORMULA_PARAMETERS.map((p) => p.name)).toEqual([
      "Largo",
      "Base",
      "Ancho",
      "Altura",
      "Largo adicional",
      "Largo externo",
      "Base externa",
      "Ancho externo",
      "Altura externa",
      "Aleta inferior",
      "Aleta superior",
      "Chapeton",
      "Superposicion aletas",
      "t",
      "Gramaje teorico",
      "tr1",
      "tr2",
      "tr3",
      "tr4",
      "tr5",
      "tr6",
      "tr7",
      "tr8",
      "tr9",
      "tr10",
      "tr11",
      "tr12",
      "tr13",
      "tr14",
      "tr15",
      "tr16",
      "Rotacion obligatoria",
      "Repeticiones ancho",
      "Repeticiones largo",
    ]);
    expect(FORMULA_PARAMETERS).toHaveLength(34);
  });

  it("derives every example from TESTEAR_FIXTURE (no second copy)", () => {
    for (const parameter of FORMULA_PARAMETERS) {
      expect(parameter.example).toBe(TESTEAR_FIXTURE[parameter.name]);
    }
    expect(Object.keys(TESTEAR_FIXTURE)).toHaveLength(34);
  });
});

describe("empty formulas (AC-7)", () => {
  it("evaluates empty/whitespace/null to 0", () => {
    expect(evaluate("", TESTEAR_FIXTURE)).toBe(0);
    expect(evaluate("   ", TESTEAR_FIXTURE)).toBe(0);
    expect(evaluate(null, TESTEAR_FIXTURE)).toBe(0);
    expect(evaluate(undefined, TESTEAR_FIXTURE)).toBe(0);
  });

  it("validates empty/whitespace/null as ok", () => {
    expect(validate("")).toEqual({ ok: true });
    expect(validate("   ")).toEqual({ ok: true });
    expect(validate(null)).toEqual({ ok: true });
    expect(validate(undefined)).toEqual({ ok: true });
  });
});

describe("evaluate never throws (AC-8)", () => {
  // ≥20 malformed inputs: each must evaluate to silent 0 AND fail validate
  // with a non-empty error message.
  const malformed: string[] = [
    "(",
    ")",
    "[Largo",
    "1 +",
    "Foo(1)",
    "[Nope]",
    "1,5",
    "'x'",
    '"x"',
    "1e3",
    "Largo externo", // bare multi-word name is a parse error (D-9)
    "abs(-7", // unterminated call
    "1..2",
    "1.",
    "[]",
    "2 ** 3",
    "= 5",
    "#largo",
    "if(1,2)", // wrong arity
    "In(1, 2)", // capital In is an unknown function
    "5 / ",
    "1 5",
    "[Largo]]",
    "[Largo]+1,5",
  ];

  it.each(malformed)("evaluate(%j) === 0 and validate fails", (formula) => {
    expect(evaluate(formula, TESTEAR_FIXTURE)).toBe(0);
    const result = validate(formula);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect((result.error as string).length).toBeGreaterThan(0);
  });
});

describe("lists split at field level (AC-18)", () => {
  const R6 =
    "[Chapeton]|[Base externa]|[Largo externo]|[Base externa]|[Largo externo]";

  it("splits R-6's string into 5 numbers in source order", () => {
    expect(evaluateList(R6, TESTEAR_FIXTURE)).toEqual([30, 404, 504, 404, 504]);
  });

  it("treats empty segments as 0", () => {
    expect(evaluateList("[Largo]||[Ancho]", TESTEAR_FIXTURE)).toEqual([
      500, 0, 400,
    ]);
  });

  it("validateList reports one entry per segment with 0-based indexes", () => {
    const result = validateList("[Largo]||[Ancho]");
    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(3);
    expect(result.segments.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(result.segments.every((s) => s.ok)).toBe(true);
  });

  it("flags the failing segment by index", () => {
    const result = validateList("[Largo]|[Nope]|[Ancho]");
    expect(result.ok).toBe(false);
    expect(result.segments[1].ok).toBe(false);
    expect(result.segments[1].index).toBe(1);
    expect(result.segments[0].ok).toBe(true);
    expect(result.segments[2].ok).toBe(true);
  });

  it("evaluateList(null) returns []", () => {
    expect(evaluateList(null, TESTEAR_FIXTURE)).toEqual([]);
    expect(evaluateList(undefined, TESTEAR_FIXTURE)).toEqual([]);
    expect(validateList(null)).toEqual({ ok: true, segments: [] });
  });

  it("never mutates the scope object", () => {
    const scope = { ...TESTEAR_FIXTURE };
    const snapshot = { ...scope };
    evaluate("2*([Largo externo]+[Base externa]+[t])+[Chapeton]", scope);
    evaluateList(R6, scope);
    expect(scope).toEqual(snapshot);
  });
});
