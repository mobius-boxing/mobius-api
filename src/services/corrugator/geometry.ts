import { roundHalfUpInt } from "./rounding";
import {
  CombinationFigures,
  CombinationItem,
  EngineInput,
  EngineMachine,
  EngineOrder,
  ItemFigures,
} from "./types";

/**
 * One lane group with its run dimensions resolved (Pandora `Item`, tier 1:
 * Repeticiones = 1, no dimension tolerance). Unrotated: the sheet's length runs
 * along the web; rotated: its width does.
 */
export interface Lane {
  orderKey: string;
  count: number;
  rotated: boolean;
  runLength: number; // mm along the web (Item.LargoPlancha)
  runWidth: number; // mm across the web (Item.AnchoPlancha)
  scoreLineCount: number;
}

export function toLane(
  order: EngineOrder,
  count: number,
  rotated: boolean,
): Lane {
  return {
    orderKey: order.key,
    count,
    rotated,
    runLength: rotated ? order.sheetWidth : order.sheetLength,
    runWidth: rotated ? order.sheetLength : order.sheetWidth,
    scoreLineCount: order.scoreLineCount,
  };
}

export function lanesOf(input: EngineInput, items: CombinationItem[]): Lane[] {
  return items.map((it) => {
    const order = input.orders.find((o) => o.key === it.orderKey);
    if (!order) throw new Error(`Unknown order ${it.orderKey}`);
    return toLane(order, it.count, it.rotated);
  });
}

/** Combinacion.Trim (mm). */
export const trimOf = (lanes: Lane[]): number =>
  lanes.reduce((acc, l) => acc + l.runWidth * l.count, 0);

/** Combinacion.Elementos. */
export const elementsOf = (lanes: Lane[]): number =>
  lanes.reduce((acc, l) => acc + l.count, 0);

/** Combinacion.Trazadores. */
export const scoreLinesOf = (lanes: Lane[]): number =>
  lanes.reduce((acc, l) => acc + l.count * l.scoreLineCount, 0);

/** Combinacion.DimensionesConsistentes: one order never runs with two produced sizes. */
export function dimensionsConsistent(lanes: Lane[]): boolean {
  return !lanes.some((a) =>
    lanes.some(
      (b) =>
        a.orderKey === b.orderKey &&
        (a.runWidth !== b.runWidth || a.runLength !== b.runLength),
    ),
  );
}

/** Item.ProduccionLineal / 1000 — sheets per metre of run. */
export const linearProduction = (lane: Lane): number =>
  lane.runLength > 0 ? (lane.count / lane.runLength) * 1000 : 0;

/** Item.PlanchasProgramadas getter (Item.cs:35-45). */
export const plannedSheets = (lane: Lane, meters: number): number =>
  lane.runLength > 0
    ? roundHalfUpInt((1000 * meters * lane.count) / lane.runLength)
    : 0;

/** Item.Golpes getter (Item.cs:49-59). */
export const strokes = (lane: Lane, meters: number): number =>
  lane.runLength > 0 ? roundHalfUpInt((1000 * meters) / lane.runLength) : 0;

/** Item.PlanchasProgramadas setter → metres (Item.cs:43). */
export const metersForSheets = (lane: Lane, sheets: number): number =>
  sheets > 0
    ? roundHalfUpInt((sheets * lane.runLength) / (1000 * lane.count))
    : 0;

/** Combinacion.DesperdicioLineal (kg/m); null when the grammage is unknown. */
export const wasteLinear = (
  width: number,
  trim: number,
  grammage: number,
): number | null => (grammage > 0 ? ((width - trim) * grammage) / 1e6 : null);

/** Per-combination figures on machine `m` (Combinacion.cs:57-98, model E-1…E-8). */
export function combinationFigures(
  lanes: Lane[],
  machine: EngineMachine,
  meters: number,
  grammage: number,
  tables: number,
): CombinationFigures {
  const width = machine.width;
  const trim = trimOf(lanes);
  const usableWidth = width - machine.trim;
  const usable = usableWidth > 0 ? (100 * trim) / usableWidth : 100;
  const waste = wasteLinear(width, trim, grammage);
  const items: ItemFigures[] = lanes.map((l) => ({
    orderKey: l.orderKey,
    runLength: l.runLength,
    runWidth: l.runWidth,
    plannedSheets: plannedSheets(l, meters),
    strokes: strokes(l, meters),
    linearProduction: linearProduction(l),
  }));
  return {
    width,
    trim,
    transversalRefile: width - machine.trim - trim,
    refile: 100 - usable,
    fullRefile: 100 - (width > 0 ? (100 * trim) / width : 100),
    wasteLinear: waste,
    scrapKg: waste === null ? null : meters * waste,
    elements: elementsOf(lanes),
    tables,
    scoreLines: scoreLinesOf(lanes),
    items,
  };
}
