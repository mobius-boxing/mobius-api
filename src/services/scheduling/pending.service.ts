import {
  IRouteStage,
  IStageSupply,
} from "../../interfaces/production-route/production-route.interfaces";
import { roundHalfEven } from "../corrugator/rounding";
import { deriveEdges } from "../route-validator.service";

/**
 * Corrugator pending quantities — Procusto parity (spec 13 §A/§B):
 * ConsultasProgramacion.Factores, CalculosBocas.Relacion,
 * TareaPotencial.Tolerado/Pendiente and ProgramarCorrugado.PendientesDeCorrugado.
 * Doubles throughout; the only rounding is the banker's round of the pending.
 */

export interface SheetsPerUnitResult {
  sheetsPerUnit: number;
  source: "route" | "quantity";
  warning?: string;
}

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

/** P-1: corrugation-stage sheets per finished unit, falling back to 1 with a warning. */
export function corrugationSheetsPerUnit(
  stages: IRouteStage[] | null,
  quantity: number,
): SheetsPerUnitResult {
  const fallback = (warning: string): SheetsPerUnitResult => ({
    sheetsPerUnit: 1,
    source: "quantity",
    warning,
  });
  if (!stages || stages.length === 0)
    return fallback(
      "La orden no tiene ruta de producción; se asume 1 plancha por unidad",
    );
  if (!(quantity > 0))
    return fallback(
      "La orden no tiene cantidad; se asume 1 plancha por unidad",
    );
  const corrugation = stages
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        s.isCorrugation && s.supplies.some((x) => x.direction === "output"),
    );
  if (corrugation.length === 0) {
    return fallback(
      "La ruta no tiene etapa de corrugado; se asume 1 plancha por unidad",
    );
  }
  const factors = stageFactors(stages, quantity);
  const values = corrugation.map(({ i }) => factors.get(i));
  if (values.some((v) => v === undefined || !Number.isFinite(v) || v <= 0)) {
    return fallback(
      "Faltan cantidades en los insumos de la ruta; se asume 1 plancha por unidad",
    );
  }
  const sheetsPerUnit = Math.max(...(values as number[])) / quantity;
  return corrugation.length > 1
    ? {
        sheetsPerUnit,
        source: "route",
        warning: "La ruta tiene varias etapas de corrugado; se usa la mayor",
      }
    : { sheetsPerUnit, source: "route" };
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
