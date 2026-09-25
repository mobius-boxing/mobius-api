import {
  IRouteStage,
  IStageSupply,
} from "../../../../interfaces/production-route/production-route.interfaces";
import {
  corrugationSheetsPerUnit,
  pendingSheets,
  stageFactors,
  tolerated,
} from "../../../../services/scheduling/pending.service";

const supply = (
  direction: "input" | "output",
  supplyType: string,
  supplyId: number,
  quantity: number | null,
): IStageSupply =>
  ({
    direction,
    supplyType,
    supplyId,
    quantity,
    repetitionsWidth: 1,
    repetitionsLength: 1,
    allowsSimilar: false,
  }) as IStageSupply;

const stage = (
  number: number,
  supplies: IStageSupply[],
  isCorrugation = false,
): IRouteStage =>
  ({
    number,
    isCorrugation,
    setupTimeMinutes: 0,
    machines: [],
    supplies,
  }) as IRouteStage;

// Corrugator makes sheet 10; the die-cutter takes 2 of sheet 10 per cycle and yields box 20.
const corrugator = stage(
  1,
  [supply("input", "paper", 1, 1), supply("output", "sheet", 10, 1)],
  true,
);
const dieCutter = stage(2, [
  supply("input", "sheet", 10, 2),
  supply("output", "finishedGood", 20, 1),
]);

describe("Factores / Relacion (ConsultasProgramacion.cs:14-38, CalculosBocas.cs:57-66)", () => {
  it("propagates the terminal quantity back through next-input / prev-output ratios", () => {
    const factors = stageFactors([corrugator, dieCutter], 500);
    expect(factors.get(1)).toBe(500);
    expect(factors.get(0)).toBe(1000);
  });

  it("gives sheets per unit from the corrugation stage", () => {
    expect(corrugationSheetsPerUnit([corrugator, dieCutter], 500)).toEqual({
      sheetsPerUnit: 2,
      source: "route",
    });
  });

  it("falls back to one sheet per unit, with a reason, when the route cannot say", () => {
    expect(corrugationSheetsPerUnit(null, 500)).toMatchObject({
      sheetsPerUnit: 1,
      source: "quantity",
    });
    expect(
      corrugationSheetsPerUnit(
        [{ ...corrugator, isCorrugation: false }, dieCutter],
        500,
      ).source,
    ).toBe("quantity");
    const missing = stage(2, [
      supply("input", "sheet", 10, null),
      supply("output", "finishedGood", 20, 1),
    ]);
    expect(corrugationSheetsPerUnit([corrugator, missing], 500)).toMatchObject({
      sheetsPerUnit: 1,
      source: "quantity",
    });
  });
});

describe("Tolerado / pending (TareaPotencial.cs:75-82, ProgramarCorrugado.cs:198)", () => {
  const cfg = { absolute: 200, relative: 0, underrunPercentage: 0 };

  it("snaps a remainder inside the band to zero", () => {
    expect(tolerated(150, 1000, cfg)).toBe(0);
    expect(tolerated(-200, 1000, cfg)).toBe(0);
    expect(tolerated(201, 1000, cfg)).toBe(201);
  });

  it("widens the band with the part underrun and the relative tolerance", () => {
    expect(tolerated(450, 10000, { ...cfg, underrunPercentage: 5 })).toBe(0);
    expect(
      tolerated(501, 10000, { ...cfg, underrunPercentage: 3, relative: 2 }),
    ).toBe(501);
  });

  it("nets allocations, rounds half to even and never goes negative", () => {
    expect(pendingSheets(5000, 0, cfg)).toBe(5000);
    expect(pendingSheets(5000, 4850, cfg)).toBe(0);
    expect(pendingSheets(1000.5, 0, cfg)).toBe(1000);
    expect(pendingSheets(1001.5, 0, cfg)).toBe(1002);
    expect(pendingSheets(1000, 1500, cfg)).toBe(0);
    expect(pendingSheets(150, 0, cfg)).toBe(0);
  });
});
