/**
 * Corpus sweep — AC-20: every distinct real Modelo formula (87 live Modelos,
 * real-formulas.md) validates under the engine, proving the D-9/D-10
 * narrowed grammar does not reject production data.
 *
 * The entry count is asserted as a literal so a truncated corpus file fails
 * instead of trivially passing. known-invalid.json entries must exist in the
 * corpus, carry a written reason AND actually fail — the exemption list
 * cannot silently rot.
 */
import * as fs from "fs";
import * as path from "path";
import { validate, validateList } from "../index";

type CorpusField = { kind: "scalar" | "list"; formulas: string[] };
type CorpusFile = { fields: Record<string, CorpusField> };
type KnownInvalidFile = {
  entries: Array<{ field: string; formula: string; reason: string }>;
};

const corpus: CorpusFile = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "real-corpus.json"), "utf8"),
);
const knownInvalidPath = path.resolve(__dirname, "known-invalid.json");
const knownInvalid: KnownInvalidFile = fs.existsSync(knownInvalidPath)
  ? JSON.parse(fs.readFileSync(knownInvalidPath, "utf8"))
  : { entries: [] };

const isExempt = (field: string, formula: string): boolean =>
  knownInvalid.entries.some(
    (entry) => entry.field === field && entry.formula === formula,
  );

// 343 distinct strings in real-formulas.md minus the 6 bare-NULL rows (Q-F6).
const CORPUS_ENTRY_COUNT = 337;
const FIELD_KEYS = [
  "sheetLengthFormula",
  "sheetWidthFormula",
  "corrugationScoreLineFormulas",
  "printScoreLineFormulas",
  "lowerFlapFormula",
  "upperFlapFormula",
  "externalLengthDeltaFormula",
  "externalWidthDeltaFormula",
  "externalHeightDeltaFormula",
  "boxSurfaceFormula",
] as const;

describe("real Modelo formula corpus (AC-20)", () => {
  it(`covers all 10 Modelo formula fields with ${CORPUS_ENTRY_COUNT} entries`, () => {
    expect(Object.keys(corpus.fields).sort()).toEqual([...FIELD_KEYS].sort());
    const total = Object.values(corpus.fields).reduce(
      (sum, field) => sum + field.formulas.length,
      0,
    );
    expect(total).toBe(CORPUS_ENTRY_COUNT);
  });

  for (const key of FIELD_KEYS) {
    describe(key, () => {
      const field = corpus.fields[key];

      it("every distinct real formula validates", () => {
        const failures: string[] = [];
        for (const formula of field.formulas) {
          if (isExempt(key, formula)) continue;
          const result =
            field.kind === "list" ? validateList(formula) : validate(formula);
          if (!result.ok) failures.push(formula);
        }
        expect(failures).toEqual([]);
      });
    });
  }

  it("no formula uses a comma decimal (Q-F3 — a hit here is an escalation)", () => {
    // A comma outside a function-argument context would already fail
    // validation; this pins the specific `1,5` decimal pattern regardless.
    for (const field of Object.values(corpus.fields)) {
      for (const formula of field.formulas) {
        expect(formula).not.toMatch(/\d,\d/);
      }
    }
  });

  describe("known-invalid exemptions", () => {
    it("every exemption exists in the corpus, has a reason, and truly fails", () => {
      for (const entry of knownInvalid.entries) {
        expect(typeof entry.reason).toBe("string");
        expect(entry.reason.length).toBeGreaterThan(20);
        const field = corpus.fields[entry.field];
        expect(field).toBeDefined();
        expect(field.formulas).toContain(entry.formula);
        const result =
          field.kind === "list"
            ? validateList(entry.formula)
            : validate(entry.formula);
        expect(result.ok).toBe(false);
        // Q-F3: comma decimals may never be exempted — they must escalate.
        expect(entry.formula).not.toMatch(/\d,\d/);
      }
    });
  });
});
