/**
 * Score lines helpers — specs/parts/07-score-lines.md formats.
 *
 * NOTE the split: parse/format/mask tests are SPEC-anchored. The
 * interpretation-direction tests are PROVISIONAL characterization tests —
 * Q-S1 (absolute vs gaps) is explicitly UNRESOLVED in the spec and pinned
 * only by the decompile-derived guess; they assert what the code currently
 * does, not verified truth. When QA answers Q-S1, either promote them or fix
 * `interpretScoreLines` and update them — a red here after changing the
 * direction is EXPECTED, not a regression.
 */
import { describe, it, expect } from "@jest/globals";
import {
  parseScoreLines,
  formatScoreLines,
  isValidScoreLinesText,
  interpretScoreLines,
} from "../../../services/score-lines/score-lines.helper";

describe("score-lines helper", () => {
  it("parses the classic pattern", () => {
    expect(parseScoreLines("65;1100;65")).toEqual([65, 1100, 65]);
  });

  it("tolerates spaces and European decimal commas", () => {
    expect(parseScoreLines("65,5; 1100,3 ;65,5")).toEqual([65.5, 1100.3, 65.5]);
  });

  it("handles single value, empty, and null", () => {
    expect(parseScoreLines("100")).toEqual([100]);
    expect(parseScoreLines("")).toEqual([]);
    expect(parseScoreLines(null)).toEqual([]);
  });

  it("drops empty tokens: ';;' and trailing ';'", () => {
    expect(parseScoreLines("65;;65")).toEqual([65, 65]);
    expect(parseScoreLines("65;70;")).toEqual([65, 70]);
  });

  it("drops malformed multi-dot tokens ('1.2.3')", () => {
    expect(parseScoreLines("1.2.3;70")).toEqual([70]);
  });

  it("normalizes ALL commas in a token (two-comma token drops as malformed)", () => {
    // '1,000,5' → '1.000.5' → NaN → dropped (was mis-parsed pre-fix when only
    // the first comma was replaced).
    expect(parseScoreLines("1,000,5;70")).toEqual([70]);
    expect(parseScoreLines("10,5;20,25")).toEqual([10.5, 20.25]);
  });

  it("rejects negatives in BOTH validator and parser (mask has no '-')", () => {
    expect(isValidScoreLinesText("-5;70")).toBe(false);
    expect(parseScoreLines("-5;70")).toEqual([70]);
  });

  it("formats with the Procusto '; ' join", () => {
    expect(formatScoreLines([100, 600, 1000])).toBe("100; 600; 1000");
  });

  it("validates the allowed character mask", () => {
    expect(isValidScoreLinesText("65; 1100,5; 65")).toBe(true);
    expect(isValidScoreLinesText("65;abc")).toBe(false);
    expect(isValidScoreLinesText(null)).toBe(true);
  });

  // ── PROVISIONAL (Q-S1 unresolved) — characterization, NOT verified truth ──
  it("PROVISIONAL(Q-S1) absolute interpretation: span = last value", () => {
    const r = interpretScoreLines("100; 600; 1000", false);
    expect(r.positions).toEqual([100, 600, 1000]);
    expect(r.totalSpan).toBe(1000);
  });

  it("PROVISIONAL(Q-S1) symmetric (mark-to-mark): values are gaps, span = sum", () => {
    const r = interpretScoreLines("100; 500; 400", true);
    expect(r.positions).toEqual([100, 600, 1000]);
    expect(r.totalSpan).toBe(1000);
  });
});
