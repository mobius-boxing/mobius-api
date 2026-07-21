/**
 * PartCalculator — specs/parts/03-calculations.md + 06-cascade-and-dimensions.md.
 * Modelo-less paths only (formula engine = module 08).
 */
import { describe, it, expect } from "@jest/globals";
import { PartCalculator } from "../../../services/part-calculator/part-calculator.service";

const calc = new PartCalculator();
const flute = { length: 6, width: 4, height: 8 };

describe("PartCalculator", () => {
  it("effectiveGrammage: part override wins, corrugation fallback", () => {
    expect(calc.effectiveGrammage(450, 500)).toBe(450);
    expect(calc.effectiveGrammage(null, 500)).toBe(500);
    expect(calc.effectiveGrammage(null, null)).toBeNull();
  });

  it("sheetSurface = L × W / 1e6 (m²), null-safe", () => {
    expect(calc.sheetSurface(1000, 800)).toBe(0.8);
    expect(calc.sheetSurface(null, 800)).toBeNull();
  });

  it("boxWeight = surface × grammage / 1000 (kg), guards non-positive grammage", () => {
    expect(calc.boxWeight(2, 500)).toBe(1);
    expect(calc.boxWeight(2, 0)).toBeNull();
    expect(calc.boxWeight(null, 500)).toBeNull();
  });

  it("internal → external adds the flute adjustment", () => {
    const part = calc.applyEdit({}, "boxLength", 500, flute, null);
    expect(part.boxLength).toBe(500);
    expect(part.externalLength).toBe(506);
  });

  it("external → internal subtracts the flute adjustment (reverse)", () => {
    const part = calc.applyEdit({}, "externalWidth", 404, flute, null);
    expect(part.externalWidth).toBe(404);
    expect(part.boxWidth).toBe(400);
  });

  it("no flute → external == internal (delta 0)", () => {
    const part = calc.applyEdit({}, "boxHeight", 300, null, null);
    expect(part.externalHeight).toBe(300);
  });

  it("null value clears the field without cascading", () => {
    const part = calc.applyEdit({ boxLength: 500, externalLength: 506 }, "boxLength", null, flute, null);
    expect(part.boxLength).toBeNull();
    expect(part.externalLength).toBe(506); // untouched — no cascade on null
  });

  it("boxSurface edit recomputes weight from effective grammage", () => {
    const part = calc.applyEdit({ grammage: null }, "boxSurface", 2, null, 500);
    expect(part.boxWeight).toBe(1);
  });

  it("grammage edit (part override) recomputes weight", () => {
    const part = calc.applyEdit({ boxSurface: 2 }, "grammage", 250, null, 500);
    expect(part.boxWeight).toBe(0.5);
  });

  it("recalculateBoxWeight refreshes from stored surface", () => {
    const part = { boxSurface: 4, grammage: null };
    expect(calc.recalculateBoxWeight(part, 500)).toBe(2);
  });
});
