import {
  enumerate,
  factibleRule,
} from "../../../../services/corrugator/combinator";
import {
  combinationFigures,
  toLane,
} from "../../../../services/corrugator/geometry";
import { mesificar, obtenerMesas } from "../../../../services/corrugator/mesas";
import {
  buildModel,
  orderBounds,
} from "../../../../services/corrugator/model-builder";
import {
  roundHalfEven,
  roundHalfUpInt,
} from "../../../../services/corrugator/rounding";
import {
  checkFeasible,
  evaluate,
  loadSolution,
  metersForPlannedSheets,
  resequence,
  suggestedMeters,
} from "../../../../services/corrugator/solution";
import {
  solveInline,
  startSolve,
} from "../../../../services/corrugator/solve-runner";
import {
  CORRUGATOR_PARAMETER_DEFAULTS,
  EngineInput,
  EngineMachine,
  EngineOrder,
  engineMachines,
} from "../../../../services/corrugator/types";

// Plant corrugator (sdf-export Corrugadoras): refile 30, 5 elements, 2 tables, 1/1/1 per table, 20 score lines.
const plant = (width: number, uuid = "m1"): EngineMachine => ({
  key: `${uuid}:${width}`,
  machineUuid: uuid,
  code: String(width),
  description: null,
  width,
  physicalWidth: 1800,
  trim: 30,
  maxElements: 5,
  tableCount: 2,
  formatsPerTable: 1,
  ordersPerFormat: 1,
  ordersPerTable: 1,
  sheetLengthMin: 0,
  sheetLengthMax: 0,
  maxScoreLines: 20,
});

const order = (
  key: string,
  sheetLength: number,
  sheetWidth: number,
  quantity: number,
  extra: Partial<EngineOrder> = {},
): EngineOrder => ({
  key,
  sheetLength,
  sheetWidth,
  quantity,
  underrunPercentage: 0,
  overrunPercentage: 0,
  priority: "normal",
  partialProduction: true,
  allowsRotation: false,
  scoreLineCount: 0,
  ...extra,
});

const input = (
  orders: EngineOrder[],
  machines: EngineMachine[],
  params: Partial<EngineInput["parameters"]> = {},
): EngineInput => ({
  orders,
  machines,
  parameters: { ...CORRUGATOR_PARAMETER_DEFAULTS, ...params },
  grammage: 500,
});

// A: 590 across → 3 lanes = 1770 = 1800 − 30 trim. B: 440 across → 4 lanes = 1760.
const A = order("A", 1000, 590, 3000);
const B = order("B", 800, 440, 2000);

describe("rounding", () => {
  it("rounds half to even like .NET Math.Round and half up like (int)(x+0.5)", () => {
    expect([0.5, 1.5, 2.5, 3.5, -1.5, 2.4999].map(roundHalfEven)).toEqual(
      [0, 2, 2, 4, -2, 2],
    );
    expect([0.5, 1.5, 2.4999, 2.5].map(roundHalfUpInt)).toEqual([1, 2, 2, 3]);
  });
});

describe("geometry (Combinacion.cs / Item.cs)", () => {
  it("computes trim, refiles, waste, planned sheets and strokes for 3×A at 1000 m", () => {
    const lanes = [toLane(A, 3, false)];
    const f = combinationFigures(lanes, plant(1800), 1000, 500, 1);
    expect(f.trim).toBe(1770);
    expect(f.transversalRefile).toBe(0);
    expect(f.refile).toBe(0);
    expect(f.fullRefile).toBeCloseTo(100 - (100 * 1770) / 1800, 12);
    expect(f.wasteLinear).toBeCloseTo((30 * 500) / 1e6, 15);
    expect(f.scrapKg).toBeCloseTo(15, 9);
    expect(f.items[0]).toMatchObject({
      runLength: 1000,
      runWidth: 590,
      plannedSheets: 3000,
      strokes: 1000,
    });
  });

  it("swaps run dimensions for a rotated lane", () => {
    expect(toLane(order("R", 1200, 300, 1), 2, true)).toMatchObject({
      runLength: 300,
      runWidth: 1200,
    });
  });
});

describe("mesas (Mesificador + ObtenerMesas)", () => {
  const a = toLane(order("a", 1000, 400, 1), 1, false);
  const b = toLane(order("b", 800, 400, 1), 1, false);
  const c = toLane(order("c", 1000, 300, 1), 1, false);

  it("groups lanes by run length in first-appearance order", () => {
    expect(mesificar([a, b, c]).map((l) => l.orderKey)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("splits shared stations only while below the machine's table count", () => {
    const lanes = mesificar([a, b, c]);
    expect(obtenerMesas(lanes, 2).map((m) => m.map((l) => l.orderKey))).toEqual(
      [["a", "c"], ["b"]],
    );
    expect(obtenerMesas(lanes, 3).map((m) => m.map((l) => l.orderKey))).toEqual(
      [["a"], ["c"], ["b"]],
    );
  });
});

describe("feasibility (Combinador.Factible)", () => {
  it("reports the first failing rule in C# order", () => {
    const x = order("x", 1000, 590, 1);
    const y = order("y", 1000, 580, 1);
    const one = { ...plant(1800), tableCount: 1, formatsPerTable: 0, ordersPerFormat: 0 };
    const inp = input([x, y], [one], { scrapAbsolute: 1000 });
    const lanes = mesificar([toLane(x, 1, false), toLane(y, 1, false)]);
    expect(factibleRule(inp, lanes, one)).toBe("orders-per-table");
    expect(factibleRule(input([x, y], [one]), lanes, one)).toBe(
      "scrap-absolute",
    );
    expect(
      checkFeasible(inp, {
        machineKey: one.key,
        items: [{ orderKey: "x", count: 3, rotated: false }],
      }),
    ).toEqual({ ok: true });
    expect(
      checkFeasible(inp, {
        machineKey: one.key,
        items: [{ orderKey: "x", count: 4, rotated: false }],
      }),
    ).toEqual({
      ok: false,
      rule: "trim-exceeds-width",
    });
  });
});

describe("enumerate (Combinador.Generar)", () => {
  it("emits exactly the patterns within the scrap and machine limits", () => {
    const result = enumerate(input([A, B], [plant(1800)]));
    expect(result.status).toBe("ok");
    const shapes = result.candidates
      .map((c) => c.items.map((i) => `${i.count}${i.orderKey}`).join("+"))
      .sort();
    expect(shapes).toEqual(["3A", "4B"]);
  });

  it("offers every reel width of a machine as its own format (D-23)", () => {
    const machines = engineMachines([
      {
        machineUuid: "m1",
        code: "C1",
        description: null,
        width: 1800,
        widths: [1800, 1650],
        trim: 30,
        maxElements: 5,
        tableCount: 2,
        formatsPerTable: 1,
        ordersPerFormat: 1,
        ordersPerTable: 1,
        sheetLengthMin: 0,
        sheetLengthMax: 0,
        maxScoreLines: 20,
      },
    ]);
    expect(machines.map((m) => [m.key, m.width, m.physicalWidth])).toEqual([
      ["m1:1800", 1800, 1800],
      ["m1:1650", 1650, 1800],
    ]);
    const C = order("C", 1000, 405, 100); // 4 × 405 = 1620 fits 1650 − 30
    const keys = enumerate(input([A, C], machines)).candidates.map(
      (c) =>
        `${c.machineKey}:${c.items.map((i) => `${i.count}${i.orderKey}`).join("+")}`,
    );
    expect(keys).toEqual(expect.arrayContaining(["m1:1800:3A", "m1:1650:4C"]));
  });

  it("stops with too-many-combinations when limitCombinations is reached", () => {
    expect(
      enumerate(input([A, B], [plant(1800)], { limitCombinations: 1 })).status,
    ).toBe("too-many-combinations");
  });
});

describe("model and solve", () => {
  it("writes demand rows, slack costs and min-run binaries in CPLEX-LP text", () => {
    const inp = input([A, B], [plant(1800)]);
    const model = buildModel(inp, enumerate(inp).candidates);
    expect(model.lp).toContain("dlo0: 3 x1 + v0 >= 3000");
    expect(model.lp).toContain("dhi1: 5 x0 <= 2000");
    expect(model.lp).toMatch(/obj: 0\.02 x0 \+ 0\.015 x1 \+ 10 v0 \+ 10 v1/);
    expect(model.lp).toContain("run0b: x0 - 500 y0 >= 0");
    expect(model.lp).toContain("Binary");
  });

  it("covers both orders exactly: 3A for 1000 m and 4B for 400 m (min run 300)", async () => {
    const inp = input([A, B], [plant(1800)], { minRunLength: 300 });
    const outcome = await solveInline(inp);
    expect(outcome.status).toBe("ok");
    expect(
      outcome.combinations.map((c) => [
        c.items.map((i) => `${i.count}${i.orderKey}`).join("+"),
        c.meters,
        c.sequence,
      ]),
    ).toEqual([
      ["4B", 400, 1],
      ["3A", 1000, 2],
    ]);
    const figures = evaluate(inp, outcome.combinations);
    expect(
      figures.perOrder.map((o) => [o.orderKey, o.plannedSheets, o.state]),
    ).toEqual([
      ["A", 3000, "complete"],
      ["B", 2000, "complete"],
    ]);
    expect(figures.summary.totalMeters).toBe(1400);
  });

  it("leaves an order short rather than run below the minimum run", async () => {
    // 4B needs 400 m but runs must be ≥ 500 m and the upper bound is hard: B stays empty.
    const outcome = await solveInline(input([A, B], [plant(1800)]));
    const figures = evaluate(
      input([A, B], [plant(1800)]),
      outcome.combinations,
    );
    expect(figures.perOrder.find((o) => o.orderKey === "B")?.state).toBe(
      "empty",
    );
    expect(outcome.combinations.every((c) => c.meters >= 500)).toBe(true);
  });

  it("runs the same pipeline in a worker thread", async () => {
    const outcome = await startSolve(
      input([A, B], [plant(1800)], { minRunLength: 300 }),
    ).result;
    expect(outcome.status).toBe("ok");
    expect(outcome.combinations).toHaveLength(2);
  }, 30000);

  it("resolves a cancelled worker as cancelled", async () => {
    const handle = startSolve(input([A, B], [plant(1800)]));
    handle.cancel();
    expect((await handle.result).status).toBe("cancelled");
  });
});

describe("edits", () => {
  const inp = input([A, B], [plant(1800)], { minRunLength: 300 });
  const threeA = {
    machineKey: "m1:1800",
    items: [{ orderKey: "A", count: 3, rotated: false }],
  };

  it("converts planned sheets to metres with the Item.cs:43 setter", () => {
    expect(metersForPlannedSheets(inp, threeA, "A", 1500)).toBe(500);
    expect(metersForPlannedSheets(inp, threeA, "A", 1501)).toBe(500);
    expect(metersForPlannedSheets(inp, threeA, "A", 1502)).toBe(501);
  });

  it("suggests metres covering the order's shortfall, at least the minimum run", () => {
    const existing = [{ ...threeA, sequence: 1, meters: 600 }]; // 1800 sheets planned
    expect(suggestedMeters(inp, existing, threeA, "A")).toBe(400);
  });

  it("keeps sequence contiguous per physical machine across reel widths", () => {
    const seq = resequence([
      { machineKey: "m1:1800", items: [], sequence: 9, meters: 1 },
      { machineKey: "m2:1650", items: [], sequence: 9, meters: 1 },
      { machineKey: "m1:1650", items: [], sequence: 9, meters: 1 },
    ]);
    expect(seq.map((c) => c.sequence)).toEqual([1, 1, 2]);
  });

  it("drops runs below the thresholds and orders a machine's runs by reel width", () => {
    const machines = [plant(1650), plant(1800)];
    const inp2 = input([A], machines);
    const cands = [
      {
        machineKey: "m1:1650",
        items: [{ orderKey: "A", count: 2, rotated: false }],
      },
      {
        machineKey: "m1:1800",
        items: [{ orderKey: "A", count: 3, rotated: false }],
      },
      {
        machineKey: "m1:1800",
        items: [{ orderKey: "A", count: 1, rotated: false }],
      },
    ];
    const loaded = loadSolution(inp2, cands, [700.4, 500.5, 1e-9]);
    expect(loaded.map((c) => [c.machineKey, c.meters, c.sequence])).toEqual([
      ["m1:1800", 501, 1],
      ["m1:1650", 700, 2],
    ]);
  });

  it("uses Pedido.cs bounds with quantity tolerances and optional orders", () => {
    const o = order("T", 1000, 500, 1000, {
      underrunPercentage: 5,
      overrunPercentage: 10,
    });
    expect(orderBounds(o, input([o], [plant(1800)]))).toEqual({
      lower: 950,
      upper: 1100,
    });
    expect(
      orderBounds({ ...o, priority: "optional" }, input([o], [plant(1800)]))
        .lower,
    ).toBe(0);
  });
});
