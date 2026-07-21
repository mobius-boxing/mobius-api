import {
  IRouteStage,
  IRouteProblem,
  IRouteValidation,
  IStageSupply,
} from "../interfaces/production-route/production-route.interfaces";

/**
 * Route validation mirroring `RutaProduccion.Problemas()` (module 12,
 * 02-validation-and-invariants.md, V1–V13). Two-tier severity: `critical`
 * blocks save; `warnings` surface but never block (parity with
 * Problema.Advertencia).
 *
 * All arithmetic is JS numbers (IEEE-754 double) on purpose — V4 is an EXACT
 * float equality (`Bocas !== 1.0`) and must reproduce .NET's double math,
 * including aggregation order (spec 03 §1).
 */

const supplyKey = (s: IStageSupply) => `${s.supplyType}:${s.supplyId}`;

/**
 * Etapa.Bocas per CalculosBocas.cs:15-30:
 *   inputUnits  = Σ quantity over 'sheet' + 'finishedGood' INPUT lines
 *   outputUnits = Σ quantity over 'sheet' + 'finishedGood' OUTPUT lines
 *   inReps/outReps = Π repetitions over ALL input/output lines (unfiltered)
 *   Bocas = inputUnits > 0 ? (outputUnits * outReps) / (inputUnits * inReps) : 1.0
 * Only sheet/finishedGood quantities count as units; every line's repetitions
 * enter the product (a consumable with reps ≠ 1 skews Bocas — faithful quirk).
 */
export function stageBocas(stage: IRouteStage): number {
  const unitTypes = new Set(["sheet", "finishedGood"]);
  const inputs = stage.supplies.filter((s) => s.direction === "input");
  const outputs = stage.supplies.filter((s) => s.direction === "output");

  const sumUnits = (lines: IStageSupply[]) =>
    lines
      .filter((s) => unitTypes.has(s.supplyType))
      .reduce((acc, s) => acc + (s.quantity ?? 0), 0);
  const prodReps = (lines: IStageSupply[]) =>
    lines.length
      ? lines
          .map((s) => s.repetitionsWidth * s.repetitionsLength)
          .reduce((x, y) => x * y)
      : 1.0;

  const inputUnits = sumUnits(inputs);
  const outputUnits = sumUnits(outputs);
  const inReps = prodReps(inputs);
  const outReps = prodReps(outputs);

  return inputUnits > 0.0 ? (outputUnits * outReps) / (inputUnits * inReps) : 1.0;
}

/**
 * Derived stage DAG per ConsultasEtapas: stage A precedes B iff an output of A
 * matches an input of B by supply IDENTITY (supplyType, supplyId). No
 * type-compatibility checking — identity only (parity).
 */
export function deriveEdges(stages: IRouteStage[]): Map<number, Set<number>> {
  const edges = new Map<number, Set<number>>();
  stages.forEach((_, i) => edges.set(i, new Set()));
  for (let a = 0; a < stages.length; a++) {
    const outputs = new Set(
      stages[a].supplies.filter((s) => s.direction === "output").map(supplyKey),
    );
    for (let b = 0; b < stages.length; b++) {
      if (a === b) continue;
      const feeds = stages[b].supplies.some(
        (s) => s.direction === "input" && outputs.has(supplyKey(s)),
      );
      if (feeds) edges.get(a)!.add(b);
    }
  }
  return edges;
}

/** Aciclica(): no stage reachable from itself over derived edges. */
export function isAcyclic(stages: IRouteStage[]): boolean {
  const edges = deriveEdges(stages);
  const state = new Array(stages.length).fill(0); // 0=unseen 1=visiting 2=done
  const visit = (n: number): boolean => {
    if (state[n] === 1) return false;
    if (state[n] === 2) return true;
    state[n] = 1;
    for (const next of edges.get(n)!) {
      if (!visit(next)) return false;
    }
    state[n] = 2;
    return true;
  };
  return stages.every((_, i) => visit(i));
}

export function validateRoute(route: {
  name?: string;
  isGlobal?: boolean;
  stages: IRouteStage[];
}): IRouteValidation {
  const critical: IRouteProblem[] = [];
  const warnings: IRouteProblem[] = [];
  const stages = route.stages ?? [];

  // V1 Critico — name required
  if (!route.name || !route.name.trim()) {
    critical.push({ code: "V1", message: "La ruta debe tener un nombre." });
  }
  // V2 Advertencia — at least one stage
  if (stages.length === 0) {
    warnings.push({ code: "V2", message: "La ruta no tiene etapas." });
  }

  for (const stage of stages) {
    const n = stage.number;
    // V3 Critico — machine type required
    if (!stage.machineTypeId) {
      critical.push({
        code: "V3",
        stageNumber: n,
        message: `La etapa ${n} no tiene tipo de máquina.`,
      });
    }
    // V4 Critico — corrugation stage ⇒ Bocas == 1.0 EXACTLY (float equality)
    if (stage.isCorrugation && stageBocas(stage) !== 1.0) {
      critical.push({
        code: "V4",
        stageNumber: n,
        message: `No es posible asignar más de una boca a una etapa de corrugado (etapa ${n}).`,
      });
    }
    // V5 Advertencia — at least one machine
    if (!stage.machines.length) {
      warnings.push({
        code: "V5",
        stageNumber: n,
        message: `La etapa ${n} no tiene máquinas participantes.`,
      });
    }
    // V6 Advertencia — non-global route ⇒ stage has inputs or outputs
    if (route.isGlobal === false && !stage.supplies.length) {
      warnings.push({
        code: "V6",
        stageNumber: n,
        message: `La etapa ${n} no tiene insumos de entrada ni de salida.`,
      });
    }
    // V7 Advertencia — Bocas > 0
    if (stageBocas(stage) <= 0) {
      warnings.push({
        code: "V7",
        stageNumber: n,
        message: `La etapa ${n} tiene bocas menores o iguales a cero.`,
      });
    }
    // V8 Critico — no repeated inputs except consumables
    const inputKeys = stage.supplies
      .filter((s) => s.direction === "input" && s.supplyType !== "consumable")
      .map(supplyKey);
    if (new Set(inputKeys).size !== inputKeys.length) {
      critical.push({
        code: "V8",
        stageNumber: n,
        message: `La etapa ${n} tiene insumos de entrada repetidos.`,
      });
    }
    // V9 Critico — no repeated outputs (no exception)
    const outputKeys = stage.supplies
      .filter((s) => s.direction === "output")
      .map(supplyKey);
    if (new Set(outputKeys).size !== outputKeys.length) {
      critical.push({
        code: "V9",
        stageNumber: n,
        message: `La etapa ${n} tiene insumos de salida repetidos.`,
      });
    }
    // V10/V11 Critico — no negative quantities (null allowed pre-module-11)
    for (const supply of stage.supplies) {
      if (supply.quantity != null && supply.quantity < 0) {
        critical.push({
          code: supply.direction === "input" ? "V10" : "V11",
          stageNumber: n,
          message: `La etapa ${n} tiene un insumo con cantidad negativa.`,
        });
      }
    }
  }

  // V12 Critico — consecutive 1..N numbering
  const numbers = stages.map((s) => s.number).sort((a, b) => a - b);
  if (numbers.some((num, i) => num !== i + 1)) {
    critical.push({
      code: "V12",
      message: "Las etapas no están numeradas consecutivamente desde 1.",
    });
  }

  // V13 Critico — acyclic derived DAG
  if (stages.length && !isAcyclic(stages)) {
    critical.push({
      code: "V13",
      message:
        "La ruta contiene un ciclo: dos o más etapas se consumen mutuamente sus salidas.",
    });
  }

  return { critical, warnings };
}
