import {
  IRouteStage,
  IStageSupply,
} from "../../interfaces/production-route/production-route.interfaces";
import { roundHalfEven, roundHalfUpInt } from "../corrugator/rounding";
import { deriveEdges } from "../route-validator.service";

/**
 * Corrugator pending quantities — Procusto parity (spec 13 §A/§B):
 * ConsultasProgramacion.Factores, CalculosBocas.Relacion,
 * TareaPotencial.Tolerado/Pendiente and ProgramarCorrugado.PendientesDeCorrugado.
 * Doubles throughout; the only roundings are .NET's half-to-even on the pending
 * and on programmed sheets.
 */

export interface ToleranceConfig {
  absolute: number; // app_config ToleranciaProgramacion
  relative: number; // app_config ToleranciaRelativaProgramacion (%)
  underrunPercentage: number; // products.underrunPercentage (%)
}

const supplyKey = (s: IStageSupply) => `${s.supplyType}:${s.supplyId}`;

/**
 * CalculosBocas.Relacion: over the supplies `prev` outputs and `next` consumes,
 * the largest next-input / prev-output quantity (Cantidad.Porcentaje is a plain
 * ratio for every Cantidad subclass). NaN when a quantity is missing or ≤ 0.
 */
export function stageRelation(prev: IRouteStage, next: IRouteStage): number {
  let relation = 0;
  for (const out of prev.supplies.filter((s) => s.direction === "output")) {
    const input = next.supplies.find(
      (s) => s.direction === "input" && supplyKey(s) === supplyKey(out),
    );
    if (!input) continue;
    const a = input.quantity ?? 0;
    const b = out.quantity ?? 0;
    if (!(a > 0) || !(b > 0)) return NaN;
    relation = Math.max(relation, a / b);
  }
  return relation;
}

/**
 * ConsultasProgramacion.Factores, ported literally: from every terminal stage
 * walk predecessors breadth-first, keeping the maximum factor per stage.
 */
export function stageFactors(
  stages: IRouteStage[],
  quantity: number,
): Map<number, number> {
  const edges = deriveEdges(stages);
  const previous = (b: number) =>
    stages.map((_, a) => a).filter((a) => edges.get(a)!.has(b));
  const factors = new Map<number, number>();
  const assignMax = (stage: number, value: number) => {
    const current = factors.get(stage);
    if (current === undefined || value > current || Number.isNaN(value))
      factors.set(stage, value);
  };
  const terminals = stages
    .map((_, i) => i)
    .filter((i) => edges.get(i)!.size === 0);
  for (const terminal of terminals) {
    assignMax(terminal, quantity);
    const queue = [terminal];
    const done: number[] = [];
    while (queue.length > 0) {
      const stage = queue[0];
      for (const prev of previous(stage)) {
        assignMax(
          prev,
          factors.get(stage)! * stageRelation(stages[prev], stages[stage]),
        );
        if (!done.includes(prev)) queue.push(prev);
      }
      done.push(stage);
      queue.splice(queue.indexOf(stage), 1);
    }
  }
  return factors;
}

export interface SheetsPerUnitResult {
  sheetsPerUnit: number;
  source: "route" | "quantity";
  warning?: string;
  /** The route has corrugation stages, but none runs on the given corrugators (Procusto lists no pending). */
  notOnMachine?: boolean;
}

/**
 * P-1: corrugation-stage sheets per finished unit, falling back to 1 with a
 * warning. With `machineUuids`, only the corrugation stages one of those
 * corrugators runs count, as `ProgramarCorrugado.PendientesDeCorrugado`
 * filters `Participantes` by the programme's corrugator.
 */
export function corrugationSheetsPerUnit(
  stages: IRouteStage[] | null,
  quantity: number,
  machineUuids?: string[],
): SheetsPerUnitResult {
  const fallback = (warning: string): SheetsPerUnitResult => ({ sheetsPerUnit: 1, source: "quantity", warning });
  if (!stages || stages.length === 0) return fallback("La orden no tiene ruta de producción; se asume 1 plancha por unidad");
  if (!(quantity > 0)) return fallback("La orden no tiene cantidad; se asume 1 plancha por unidad");
  const candidates = stages
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.isCorrugation && s.supplies.some((x) => x.direction === "output"));
  if (candidates.length === 0) {
    return fallback("La ruta no tiene etapa de corrugado; se asume 1 plancha por unidad");
  }
  let corrugation = machineUuids
    ? candidates.filter(({ s }) => s.machines.some((m) => m.machine && machineUuids.includes(m.machine.uuid)))
    : candidates;
  let unassignedWarning: string | undefined;
  if (corrugation.length === 0) {
    // Procusto lists no pending for a stage without corrugators; Mobius routes are still being
    // completed, so a stage naming no corrugator accepts any (D-74). Naming others still rejects.
    corrugation = candidates.filter(({ s }) => s.machines.length === 0);
    if (corrugation.length === 0) {
      return { sheetsPerUnit: 1, source: "quantity", notOnMachine: true, warning: "La ruta no pasa por la corrugadora elegida" };
    }
    unassignedWarning = "La etapa de corrugado de la ruta no tiene corrugadora asignada";
  }
  const factors = stageFactors(stages, quantity);
  const values = corrugation.map(({ i }) => factors.get(i));
  if (values.some((v) => v === undefined || !Number.isFinite(v) || v <= 0)) {
    return fallback("Faltan cantidades en los insumos de la ruta; se asume 1 plancha por unidad");
  }
  const sheetsPerUnit = Math.max(...(values as number[])) / quantity;
  if (corrugation.length > 1) {
    return { sheetsPerUnit, source: "route", warning: "La ruta tiene varias etapas de corrugado; se usa la mayor" };
  }
  return unassignedWarning ? { sheetsPerUnit, source: "route", warning: unassignedWarning } : { sheetsPerUnit, source: "route" };
}

/**
 * Sheets a registered run nets from the order's pending — Procusto's
 * `InsumoProgramadoCorrugado.PlanchasProgramadas` (`Convert.ToInt32`, half to
 * even) on the sheet length `Registrar` rounds to whole mm. Pandora's
 * displayed `Item.PlanchasProgramadas` rounds half up on the raw length.
 */
export function programmedSheets(count: number, meters: number, runLength: number): number {
  const length = roundHalfUpInt(runLength);
  return length > 0 ? roundHalfEven((count * meters * 1000) / length) : 0;
}

/** TareaPotencial.Tolerado (TareaPotencial.cs:75-82). */
export function tolerated(
  x: number,
  full: number,
  cfg: ToleranceConfig,
): number {
  const band = Math.max(
    cfg.absolute,
    (full * (cfg.underrunPercentage + cfg.relative)) / 100,
  );
  return Math.abs(x) <= band ? 0 : x;
}

/** P-3 (TareaPotencial.cs:21-44, ProgramarCorrugado.cs:197-200): no sheet stock or dispatch credits in Mobius (U-3). */
export function pendingSheets(
  required: number,
  allocated: number,
  cfg: ToleranceConfig,
): number {
  const n = roundHalfEven(tolerated(required - allocated, required, cfg));
  return n > 0 ? n : 0;
}
