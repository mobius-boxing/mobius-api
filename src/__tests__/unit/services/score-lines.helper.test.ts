/**
 * Score lines helpers — specs/parts/07-score-lines.md formats.
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

  it("formats with the Procusto '; ' join", () => {
    expect(formatScoreLines([100, 600, 1000])).toBe("100; 600; 1000");
  });

  it("validates the allowed character mask", () => {
    expect(isValidScoreLinesText("65; 1100,5; 65")).toBe(true);
    expect(isValidScoreLinesText("65;abc")).toBe(false);
    expect(isValidScoreLinesText(null)).toBe(true);
  });

  // QA-VERIFY(Q-S1): default interpretation = absolute positions.
  it("absolute interpretation: span = last value", () => {
    const r = interpretScoreLines("100; 600; 1000", false);
    expect(r.positions).toEqual([100, 600, 1000]);
    expect(r.totalSpan).toBe(1000);
  });

  it("symmetric (mark-to-mark): values are gaps, span = sum", () => {
    const r = interpretScoreLines("100; 500; 400", true);
    expect(r.positions).toEqual([100, 600, 1000]);
    expect(r.totalSpan).toBe(1000);
  });
});
