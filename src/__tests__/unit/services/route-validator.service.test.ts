/**
 * Route validator — table-driven per V-rule (module 12,
 * 02-validation-and-invariants.md). Pure functions, no DB.
 */
import { describe, it, expect } from "@jest/globals";
import {
  stageBocas,
  validateRoute,
  isAcyclic,
} from "../../../services/route-validator.service";
import {
  IRouteStage,
  IStageSupply,
} from "../../../interfaces/production-route/production-route.interfaces";

const supply = (over: Partial<IStageSupply>): IStageSupply => ({
  direction: "input",
  supplyType: "sheet",
  supplyId: 1,
  quantity: 1,
  repetitionsWidth: 1,
  repetitionsLength: 1,
  allowsSimilar: false,
  ...over,
});

const stage = (over: Partial<IRouteStage>): IRouteStage => ({
  number: 1,
  setupTimeMinutes: 0,
  machineTypeId: 7,
  machines: [{ machineId: 1, isPrimary: true }],
  supplies: [],
  ...over,
});

const codesOf = (problems: { code: string }[]) => problems.map((p) => p.code);

describe("stageBocas (CalculosBocas parity)", () => {
  it("balanced sheet in/out with reps 1 gives exactly 1.0", () => {
    const s = stage({
      supplies: [
        supply({ direction: "input", supplyId: 1, quantity: 2 }),
        supply({ direction: "output", supplyId: 2, quantity: 2 }),
      ],
    });
    expect(stageBocas(s)).toBe(1.0);
  });

  it("no unit-bearing inputs gives the 1.0 fallback", () => {
    const s = stage({
      supplies: [supply({ direction: "input", supplyType: "consumable" })],
    });
    expect(stageBocas(s)).toBe(1.0);
  });

  it("a consumable with reps ≠ 1 SKEWS Bocas (faithful quirk)", () => {
    const s = stage({
      supplies: [
        supply({ direction: "input", supplyId: 1, quantity: 1 }),
        supply({
          direction: "input",
          supplyType: "consumable",
          supplyId: 9,
          quantity: 1,
          repetitionsWidth: 2,
        }),
        supply({ direction: "output", supplyId: 2, quantity: 1 }),
      ],
    });
    // outputUnits(1) * outReps(1) / (inputUnits(1) * inReps(1*2)) = 0.5
    expect(stageBocas(s)).toBe(0.5);
  });
});

describe("validateRoute V-rules", () => {
  it("V4: corrugation stage with Bocas EXACTLY 1.0 passes; 1.0000001 is Critico", () => {
    const balanced = stage({
      isCorrugation: true,
      supplies: [
        supply({ direction: "input", supplyId: 1, quantity: 1 }),
        supply({ direction: "output", supplyId: 2, quantity: 1 }),
      ],
    });
    expect(
      codesOf(validateRoute({ name: "r", stages: [balanced] }).critical),
    ).not.toContain("V4");

    const skewed = stage({
      isCorrugation: true,
      supplies: [
        supply({ direction: "input", supplyId: 1, quantity: 1 }),
        supply({ direction: "output", supplyId: 2, quantity: 1.0000001 }),
      ],
    });
    expect(
      codesOf(validateRoute({ name: "r", stages: [skewed] }).critical),
    ).toContain("V4");
  });

  it("V8: duplicate inputs are Critico — except consumables", () => {
    const dupSheet = stage({
      supplies: [
        supply({ direction: "input", supplyId: 1 }),
        supply({ direction: "input", supplyId: 1 }),
        supply({ direction: "output", supplyId: 2 }),
      ],
    });
    expect(
      codesOf(validateRoute({ name: "r", stages: [dupSheet] }).critical),
    ).toContain("V8");

    const dupConsumable = stage({
      supplies: [
        supply({ direction: "input", supplyType: "consumable", supplyId: 3 }),
        supply({ direction: "input", supplyType: "consumable", supplyId: 3 }),
        supply({ direction: "input", supplyId: 1 }),
        supply({ direction: "output", supplyId: 2 }),
      ],
    });
    expect(
      codesOf(validateRoute({ name: "r", stages: [dupConsumable] }).critical),
    ).not.toContain("V8");
  });

  it("V9: duplicate outputs are Critico with NO exception", () => {
    const s = stage({
      supplies: [
        supply({ direction: "input", supplyId: 1 }),
        supply({ direction: "output", supplyType: "consumable", supplyId: 4 }),
        supply({ direction: "output", supplyType: "consumable", supplyId: 4 }),
      ],
    });
    expect(
      codesOf(validateRoute({ name: "r", stages: [s] }).critical),
    ).toContain("V9");
  });

  it("V10/V11: null and zero quantities are Critico", () => {
    const s = stage({
      supplies: [
        supply({ direction: "input", supplyId: 1, quantity: null }),
        supply({ direction: "output", supplyId: 2, quantity: 0 }),
      ],
    });
    const codes = codesOf(validateRoute({ name: "r", stages: [s] }).critical);
    expect(codes).toContain("V10");
    expect(codes).toContain("V11");
  });

  it("V12: a numbering gap is Critico", () => {
    const stages = [stage({ number: 1 }), stage({ number: 3 })];
    expect(codesOf(validateRoute({ name: "r", stages }).critical)).toContain(
      "V12",
    );
  });

  it("V13: mutual consumption is a cycle (Critico); a chain is not", () => {
    const a = stage({
      number: 1,
      supplies: [
        supply({ direction: "input", supplyId: 10 }),
        supply({ direction: "output", supplyId: 11 }),
      ],
    });
    const b = stage({
      number: 2,
      supplies: [
        supply({ direction: "input", supplyId: 11 }),
        supply({ direction: "output", supplyId: 10 }),
      ],
    });
    expect(isAcyclic([a, b])).toBe(false);
    expect(
      codesOf(validateRoute({ name: "r", stages: [a, b] }).critical),
    ).toContain("V13");

    const chainB = stage({
      number: 2,
      supplies: [
        supply({ direction: "input", supplyId: 11 }),
        supply({ direction: "output", supplyId: 12 }),
      ],
    });
    expect(isAcyclic([a, chainB])).toBe(true);
  });

  it("V1: missing name is Critico", () => {
    expect(codesOf(validateRoute({ name: "", stages: [] }).critical)).toContain(
      "V1",
    );
  });
});
