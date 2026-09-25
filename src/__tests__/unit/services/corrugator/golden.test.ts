import { enumerate, factibleRule } from "../../../../services/corrugator/combinator";
import { lanesOf } from "../../../../services/corrugator/geometry";
import { mesificar } from "../../../../services/corrugator/mesas";
import {
  CORRUGATOR_PARAMETER_DEFAULTS,
  EngineInput,
} from "../../../../services/corrugator/types";
import golden from "./fixtures/pandora-golden.json";

/**
 * Enumeration parity (C-7 a): the 40 most recent tier-1 solutions saved by the
 * plant's Pandora (docs/dev/pandora-re/sdf-export, 2026-09-22). Every
 * combination Pandora kept must be one our enumeration generates, unless the
 * planner built it by hand (Editor) outside the machine limits.
 */

interface GoldenItem {
  orderId: string;
  count: number;
  rotated: boolean;
  runLength: number;
  runWidth: number;
}
interface GoldenSolution {
  solutionId: string;
  environment: {
    scrapAbsolute: number;
    scrapPercentage: number;
    rotation: boolean;
  };
  machines: Array<{
    id: string;
    code: string;
    width: number;
    trim: number;
    maxElements: number;
    tableCount: number;
    formatsPerTable: number;
    ordersPerFormat: number;
    ordersPerTable: number;
    maxScoreLines: number;
    sheetLengthMin: number;
    sheetLengthMax: number;
  }>;
  orders: Array<{
    id: string;
    sheetLength: number;
    sheetWidth: number;
    quantity: number;
    rotation: boolean;
    scoreLineCount: number;
  }>;
  combinations: Array<{
    machineId: string;
    width: number;
    meters: number;
    items: GoldenItem[];
  }>;
}

const signature = (
  machineKey: string,
  items: Array<{ orderKey: string; count: number; rotated: boolean }>,
) =>
  `${machineKey}|${items
    .map((i) => `${i.orderKey}:${i.count}:${i.rotated ? "r" : "n"}`)
    .sort()
    .join(",")}`;

function toInput(s: GoldenSolution): EngineInput {
  return {
    orders: s.orders.map((o) => ({
      key: o.id,
      sheetLength: o.sheetLength,
      sheetWidth: o.sheetWidth,
      quantity: o.quantity,
      underrunPercentage: 0,
      overrunPercentage: 0,
      priority: "normal",
      partialProduction: true,
      allowsRotation: o.rotation,
      scoreLineCount: o.scoreLineCount,
    })),
    machines: s.machines.map((m) => ({
      key: m.id,
      machineUuid: "plant",
      code: m.code,
      description: null,
      width: m.width,
      physicalWidth: m.width,
      trim: m.trim,
      maxElements: m.maxElements,
      tableCount: m.tableCount,
      formatsPerTable: m.formatsPerTable,
      ordersPerFormat: m.ordersPerFormat,
      ordersPerTable: m.ordersPerTable,
      sheetLengthMin: m.sheetLengthMin,
      sheetLengthMax: m.sheetLengthMax,
      maxScoreLines: m.maxScoreLines,
    })),
    parameters: {
      ...CORRUGATOR_PARAMETER_DEFAULTS,
      scrapAbsolute: s.environment.scrapAbsolute,
      scrapPercentage: Math.min(100, s.environment.scrapPercentage),
      rotation: s.environment.rotation,
    },
    grammage: 500,
  };
}

describe("Pandora golden enumeration parity", () => {
  const solutions = golden as GoldenSolution[];
  const misses: string[] = [];
  const statuses: string[] = [];
  const edited: string[] = [];
  let total = 0;

  it.each(solutions.map((s) => [s.solutionId, s] as const))(
    "solution %s",
    (_id, s) => {
      const result = enumerate(toInput(s));
      if (result.status !== "ok")
        statuses.push(
          `${s.solutionId}: ${result.status} (${result.reason ?? ""})`,
        );
      const ours = new Set(
        result.candidates.map((c) => signature(c.machineKey, c.items)),
      );
      for (const c of s.combinations) {
        total++;
        // A planner may re-point a run to another reel width after solving (AnchoDefault ≠ Corrugadora.Ancho);
        // a width the environment never offered can only be a hand edit.
        const machine = s.machines.find((m) => m.width === c.width);
        if (!machine) {
          edited.push(`${s.solutionId}: ${c.machineId}@${c.width}`);
          continue;
        }
        const key = signature(
          machine.id,
          c.items.map((i) => ({
            orderKey: i.orderId,
            count: i.count,
            rotated: i.rotated,
          })),
        );
        if (!ours.has(key)) {
          const input = toInput(s);
          const items = c.items.map((i) => ({ orderKey: i.orderId, count: i.count, rotated: i.rotated }));
          const rule = factibleRule(input, mesificar(lanesOf(input, items)), input.machines.find((m) => m.key === machine.id)!);
          misses.push(`${s.solutionId}: ${key} (${c.meters} m) rule=${rule ?? "none"}`);
        }
      }
    },
  );

  afterAll(() => {
    // Hand-made combinations exist (4 of 11 117 break the table limits); anything above 5% is an engine defect.
    console.log(`Hand-edited widths skipped: ${edited.length}`);
    if (statuses.length)
      console.log(`Enumeration not ok:\n${statuses.join("\n")}`);
    if (misses.length)
      console.log(
        `Golden misses ${misses.length}/${total}:\n${misses.join("\n")}`,
      );
    // Every Pandora run our enumeration lacks must break a Factible rule, i.e. be a planner's hand edit.
    expect(misses.filter((m) => m.endsWith("rule=none"))).toEqual([]);
    expect(misses.length / Math.max(1, total)).toBeLessThanOrEqual(0.05);
  });
});
