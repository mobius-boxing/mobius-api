/**
 * Golden parity suite — AC-9…AC-17, AC-19. Table-driven from
 * golden-cases.json (single source of truth, also replayed by
 * repos/tests/parity/08-formula-engine against POST /models/test-formula).
 *
 * Tolerance: strict equality for Infinity and the quirk integers (Round, ^,
 * silent-0 cases); toBeCloseTo(…, 9) for non-integer doubles (L-010 — both
 * sides are IEEE-754 doubles).
 */
import * as fs from "fs";
import * as path from "path";
import { Scope, evaluate, evaluateList, validate } from "../index";

type GoldenCase = {
  id: string;
  formula: string;
  fixture: "A" | "A_ROT" | "A_ODD";
  kind: "scalar" | "list";
  expected: number | number[] | "Infinity" | "-Infinity" | "NaN";
  close?: boolean;
};

type GoldenFile = {
  fixtures: Record<"A" | "A_ROT" | "A_ODD", Scope>;
  cases: GoldenCase[];
};

const golden: GoldenFile = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "golden-cases.json"), "utf8"),
);

const NAMED_CONSTANTS: Record<string, number> = {
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
  NaN: Number.NaN,
};

function assertScalar(actual: number, kase: GoldenCase): void {
  const expected = kase.expected;
  if (typeof expected === "string") {
    if (expected === "NaN") {
      expect(Number.isNaN(actual)).toBe(true);
    } else {
      expect(actual).toBe(NAMED_CONSTANTS[expected]);
    }
    return;
  }
  if (typeof expected !== "number") {
    throw new Error(`Case ${kase.id}: scalar case with non-scalar expected`);
  }
  if (!kase.close && Number.isInteger(expected)) {
    expect(actual).toBe(expected);
  } else {
    expect(actual).toBeCloseTo(expected, 9);
  }
}

describe("golden cases (AC-9…AC-17)", () => {
  it.each(golden.cases.map((kase) => [kase.id, kase] as const))(
    "%s",
    (_id, kase) => {
      const fixture = golden.fixtures[kase.fixture];
      expect(fixture).toBeDefined();
      if (kase.kind === "list") {
        const actual = evaluateList(kase.formula, fixture);
        expect(actual).toEqual(kase.expected);
      } else {
        assertScalar(evaluate(kase.formula, fixture), kase);
      }
    },
  );

  it("the case-id set is complete (a truncated JSON fails, not skips)", () => {
    const ids = golden.cases.map((kase) => kase.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      [
        // Fixture A — engine semantics
        ...Array.from({ length: 13 }, (_, i) => `G-${i + 1}`),
        // Fixture A-REAL — real Modelo strings
        ...Array.from({ length: 9 }, (_, i) => `R-${i + 1}`),
        "R-9-odd",
        // Fixture B — NCalc quirks (G-R9/G-R15 do not exist in the corpus)
        "G-R0",
        "G-R1",
        "G-R2",
        "G-R3",
        "G-R4",
        "G-R5",
        "G-R6",
        "G-R7",
        "G-R8",
        "G-R8b",
        "G-R10",
        "G-R11",
        "G-R12",
        "G-R13",
        "G-R14",
        "G-R16",
        "G-R17",
        "G-R18",
        "G-R19",
        "G-R20",
        "G-R21",
        "G-R22",
      ].sort(),
    );
  });

  it("G-13 divide-by-zero validates ok (never guarded to 0)", () => {
    const result = validate("[Largo] / 0");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(Number.POSITIVE_INFINITY);
  });

  it("single-arg Round fails validation with a real message (AC-11)", () => {
    const result = validate("Round(2.5)");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
