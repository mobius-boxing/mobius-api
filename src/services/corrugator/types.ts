/**
 * Corrugator planning engine contract (docs/dev/corrugator-planning/model.md,
 * §Engine contract + Amendments D-5/D-23). Pure data: no HTTP, no DB.
 *
 * Units: sheet and web dimensions in mm, run lengths in m, quantities in
 * sheets, grammage in g/m², waste in kg/m and kg.
 */

export type CorrugatorPriority = "normal" | "mandatory" | "optional";
export type CorrugatorFulfillment =
  | "empty"
  | "partial"
  | "complete"
  | "exceeded";

export const CORRUGATOR_SOLVE_STATUSES = [
  "ok",
  "no-combinations",
  "too-many-combinations",
  "too-large",
  "infeasible",
  "time-limit",
  "cancelled",
  "error",
] as const;
export type CorrugatorSolveStatus = (typeof CORRUGATOR_SOLVE_STATUSES)[number];

export interface CorrugatorConstraintFlags {
  violationLower: boolean; // RestriccionesViolacionInferior
  violationUpper: boolean; // RestriccionesViolacionSuperior
  minRun: boolean; // RestriccionesMinimoTramo
  conditionalProduction: boolean; // RestriccionesProduccionCondicional
  minFormat: boolean; // RestriccionesMinimoFormato
}

export interface CorrugatorParameters {
  scrapAbsolute: number; // mm · ScrapAbsoluto
  scrapPercentage: number; // % · ScrapPorcentaje
  excessFactor: number; // % · FactorDeExceso
  toleranceQuantities: boolean; // ToleranciaCantidades
  rotation: boolean; // Rotacion
  minRunLength: number; // m · LongitudMinima
  minMeters: number; // m · MetrosMinimos (post-solve discard threshold)
  minFormatLength: number; // m · FormatoMinimo
  limitCombinations: number; // LimiteDeCombinaciones, 0 = unlimited
  costViolationLower: number;
  costViolationUpper: number;
  costViolationLowerMandatory: number;
  costViolationUpperMandatory: number;
  costFormatChange: number; // CostoCambioFormato
  averageGrammage: number; // g/m² · GramajePromedio
  roundingFactor: number; // m · FactorRedondeo
  maxGap: number; // % · GapMaximo
  timeLimitSeconds: number; // s · TiempoResolucion
  constraints: CorrugatorConstraintFlags;
}

export const CORRUGATOR_PARAMETER_DEFAULTS: CorrugatorParameters = {
  scrapAbsolute: 80,
  scrapPercentage: 100,
  excessFactor: 0,
  toleranceQuantities: true,
  rotation: true,
  minRunLength: 500,
  minMeters: 0,
  minFormatLength: 0,
  limitCombinations: 0,
  costViolationLower: 10,
  costViolationUpper: 100,
  costViolationLowerMandatory: 100,
  costViolationUpperMandatory: 1000,
  costFormatChange: 5,
  averageGrammage: 0,
  roundingFactor: 0,
  maxGap: 10,
  timeLimitSeconds: 120,
  constraints: {
    violationLower: true,
    violationUpper: false,
    minRun: true,
    conditionalProduction: false,
    minFormat: false,
  },
};

/** Physical corrugator as stored on the plan (`corrugator_plans.machines[]`). 0 = no limit. */
export interface CorrugatorMachineSnapshot {
  machineUuid: string;
  code: string | null;
  description: string | null;
  width: number; // mm, physical maximum
  widths: number[]; // mm, reel/format widths offered in this plan (D-23), each 0 < w ≤ width
  trim: number; // mm · Corrugadora.Refile
  maxElements: number; // Elementos
  tableCount: number; // Mesas
  formatsPerTable: number; // FormatosPorMesa
  ordersPerFormat: number; // PedidosPorFormato
  ordersPerTable: number; // PedidosPorMesa
  sheetLengthMin: number; // mm · LargoMinimo
  sheetLengthMax: number; // mm · LargoMaximo
  maxScoreLines: number; // Trazadores
}

/** One (machine, reel width) pair — Pandora's `Corrugadora`. */
export interface EngineMachine extends Omit<
  CorrugatorMachineSnapshot,
  "widths" | "width"
> {
  key: string; // `${machineUuid}:${width}` (machineKeyOf)
  width: number; // mm, the reel/format width (Corrugadora.Ancho)
  physicalWidth: number; // mm
}

export interface EngineOrder {
  key: string; // plan-order uuid
  sheetLength: number; // mm along the web, unrotated
  sheetWidth: number; // mm across the web, unrotated
  quantity: number; // sheets requested (Pedido.Cantidad)
  underrunPercentage: number; // %
  overrunPercentage: number; // %
  priority: CorrugatorPriority;
  partialProduction: boolean;
  allowsRotation: boolean;
  scoreLineCount: number; // Item.CantidadTrazadores per sheet
}

export interface EngineInput {
  orders: EngineOrder[];
  machines: EngineMachine[];
  parameters: CorrugatorParameters;
  grammage: number; // g/m², 0 ⇒ waste kg unknown
}

/** One lane group across the web: `count` sheets of one order side by side. */
export interface CombinationItem {
  orderKey: string;
  count: number;
  rotated: boolean;
}

export interface Candidate {
  machineKey: string;
  items: CombinationItem[];
}

export interface EngineCombination extends Candidate {
  sequence: number; // per physical machine, from 1
  meters: number; // m
}

export interface EnumerationResult {
  status: "ok" | "no-combinations" | "too-many-combinations";
  candidates: Candidate[];
  generated: number;
  elapsedMs: number;
  reason?: string;
}

export interface ItemFigures {
  orderKey: string;
  runLength: number; // mm along the web
  runWidth: number; // mm across the web
  plannedSheets: number; // Item.PlanchasProgramadas
  strokes: number; // Item.Golpes
  linearProduction: number; // sheets per m (Item.ProduccionLineal / 1000)
}

export interface CombinationFigures {
  width: number; // mm, reel width
  trim: number; // mm, Σ runWidth·count
  transversalRefile: number; // mm
  refile: number; // %
  fullRefile: number; // %
  wasteLinear: number | null; // kg/m
  scrapKg: number | null;
  elements: number;
  tables: number;
  scoreLines: number;
  items: ItemFigures[];
}

export interface OrderFigures {
  orderKey: string;
  lowerBound: number; // sheets
  upperBound: number; // sheets
  plannedSheets: number;
  fulfillment: number; // %
  state: CorrugatorFulfillment;
}

export interface CorrugatorSummary {
  totalMeters: number;
  averageRefile: number;
  averageFullRefile: number;
  averageTrim: number;
  scrapKg: number | null;
  complete: number;
  partial: number;
  empty: number;
  exceeded: number;
  averageFulfillment: number;
}

export interface EngineFigures {
  perCombination: CombinationFigures[]; // same order as the combinations passed in
  perOrder: OrderFigures[]; // same order as input.orders
  summary: CorrugatorSummary;
}

export interface SolveOutcome {
  status: CorrugatorSolveStatus;
  combinations: EngineCombination[]; // empty unless status ∈ ok | time-limit
  combinationsGenerated: number;
  log: string;
}

export type FeasibilityResult = { ok: true } | { ok: false; rule: string };

export const machineKeyOf = (machineUuid: string, width: number): string =>
  `${machineUuid}:${width}`;

/** Expand the plan's machine snapshot into one EngineMachine per reel width (D-23). */
export function engineMachines(
  snapshots: CorrugatorMachineSnapshot[],
): EngineMachine[] {
  const out: EngineMachine[] = [];
  for (const s of snapshots) {
    const { widths, width, ...rest } = s;
    const list = widths && widths.length ? widths : [width];
    for (const w of list) {
      out.push({
        ...rest,
        key: machineKeyOf(s.machineUuid, w),
        width: w,
        physicalWidth: width,
      });
    }
  }
  return out;
}
