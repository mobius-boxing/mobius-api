import {
  dimensionsConsistent,
  combinationFigures,
  Lane,
  lanesOf,
  metersForSheets,
} from "./geometry";
import { limitOrInfinity, mesificar, obtenerMesas } from "./mesas";
import { physicalRule } from "./combinator";
import { orderBounds } from "./model-builder";
import { roundHalfUpInt, roundToStep } from "./rounding";
import {
  Candidate,
  CombinationFigures,
  CorrugatorFulfillment,
  EngineCombination,
  EngineFigures,
  EngineInput,
  EngineMachine,
  FeasibilityResult,
  OrderFigures,
} from "./types";

function machineOf(input: EngineInput, machineKey: string): EngineMachine {
  const m = input.machines.find((x) => x.key === machineKey);
  if (!m) throw new Error(`Unknown machine ${machineKey}`);
  return m;
}

/** Solucion.Cumplimiento (Solucion.cs:250-266) with its ±10-sheet fudge. */
function fulfillmentState(
  planned: number,
  lower: number,
  upper: number,
): CorrugatorFulfillment {
  if (planned < 10) return "empty";
  if (planned < lower - 10) return "partial";
  if (planned < upper + 10) return "complete";
  return "exceeded";
}

function figuresOf(
  input: EngineInput,
  combination: Candidate & { meters: number },
): CombinationFigures {
  const m = machineOf(input, combination.machineKey);
  const lanes = mesificar(lanesOf(input, combination.items));
  const tables = obtenerMesas(lanes, limitOrInfinity(m.tableCount)).length;
  // Figures keep the stored lane order; mesificar only decides the stations.
  return combinationFigures(
    lanesOf(input, combination.items),
    m,
    combination.meters,
    input.grammage,
    tables,
  );
}

export function evaluate(
  input: EngineInput,
  combinations: EngineCombination[],
): EngineFigures {
  const excess = 1 + input.parameters.excessFactor / 100;
  const perCombination = combinations.map((c) => figuresOf(input, c));

  const planned = new Map<string, number>();
  perCombination.forEach((f) =>
    f.items.forEach((it) =>
      planned.set(
        it.orderKey,
        (planned.get(it.orderKey) ?? 0) + it.plannedSheets,
      ),
    ),
  );

  const perOrder: OrderFigures[] = input.orders.map((o) => {
    const { lower, upper } = orderBounds(o, input);
    const sheets = planned.get(o.key) ?? 0;
    return {
      orderKey: o.key,
      lowerBound: lower,
      upperBound: upper,
      plannedSheets: sheets,
      fulfillment:
        o.quantity > 0 ? (100 * sheets) / (o.quantity * excess) : 100,
      state: fulfillmentState(sheets, lower, upper),
    };
  });

  const totalMeters = combinations.reduce((acc, c) => acc + c.meters, 0);
  const weighted = (pick: (f: CombinationFigures) => number) =>
    totalMeters > 0
      ? perCombination.reduce(
          (acc, f, i) => acc + combinations[i].meters * pick(f),
          0,
        ) / totalMeters
      : 0;
  const scrapKnown = input.grammage > 0;
  const counted = input.orders
    .map((o, i) => ({ o, f: perOrder[i] }))
    .filter(({ o }) => o.priority !== "optional");
  const quantitySum = counted.reduce((acc, { o }) => acc + o.quantity, 0);

  return {
    perCombination,
    perOrder,
    summary: {
      totalMeters,
      averageRefile: weighted((f) => f.refile),
      averageFullRefile: weighted((f) => f.fullRefile),
      averageTrim: weighted((f) => f.trim),
      scrapKg: scrapKnown
        ? perCombination.reduce((acc, f) => acc + (f.scrapKg ?? 0), 0)
        : null,
      complete: perOrder.filter((f) => f.state === "complete").length,
      partial: perOrder.filter((f) => f.state === "partial").length,
      empty: perOrder.filter((f) => f.state === "empty").length,
      exceeded: perOrder.filter((f) => f.state === "exceeded").length,
      averageFulfillment:
        quantitySum > 0
          ? counted.reduce(
              (acc, { o, f }) =>
                acc + o.quantity * Math.min(100, f.fulfillment),
              0,
            ) / quantitySum
          : 100,
    },
  };
}

/**
 * I-9 for a manually added or edited combination: physical Factible rules on
 * its snapshot machine. Scrap limits are enumeration filters, not physical
 * limits, so a planner may knowingly accept more refile.
 */
export function checkFeasible(
  input: EngineInput,
  candidate: Candidate,
): FeasibilityResult {
  const m = input.machines.find((x) => x.key === candidate.machineKey);
  if (!m) return { ok: false, rule: "unknown-machine" };
  if (candidate.items.length === 0) return { ok: false, rule: "empty" };
  if (candidate.items.some((it) => !Number.isInteger(it.count) || it.count < 1))
    return { ok: false, rule: "count" };
  if (
    candidate.items.some(
      (it) => !input.orders.some((o) => o.key === it.orderKey),
    )
  ) {
    return { ok: false, rule: "unknown-order" };
  }
  const lanes = mesificar(lanesOf(input, candidate.items));
  if (!dimensionsConsistent(lanes))
    return { ok: false, rule: "inconsistent-dimensions" };
  const rule = physicalRule(lanes, m);
  return rule === null ? { ok: true } : { ok: false, rule };
}

function laneFor(
  input: EngineInput,
  combination: Candidate,
  orderKey: string,
): Lane {
  const lane = lanesOf(input, combination.items).find(
    (l) => l.orderKey === orderKey,
  );
  if (!lane) throw new Error(`Order ${orderKey} is not in the combination`);
  return lane;
}

export function metersForPlannedSheets(
  input: EngineInput,
  combination: Candidate,
  orderKey: string,
  sheets: number,
): number {
  return metersForSheets(laneFor(input, combination, orderKey), sheets);
}

/**
 * Metres that cover `orderKey`'s remaining requested sheets with this
 * candidate: Item.PlanchasProgramadas setter on the shortfall, at least the
 * minimum run.
 */
export function suggestedMeters(
  input: EngineInput,
  existing: EngineCombination[],
  candidate: Candidate,
  orderKey: string,
): number {
  const order = input.orders.find((o) => o.key === orderKey);
  if (!order) throw new Error(`Unknown order ${orderKey}`);
  const figures = evaluate(input, existing);
  const planned =
    figures.perOrder.find((f) => f.orderKey === orderKey)?.plannedSheets ?? 0;
  const shortfall = Math.max(0, order.quantity - planned);
  const meters = metersForSheets(
    laneFor(input, candidate, orderKey),
    shortfall,
  );
  return Math.max(meters, input.parameters.minRunLength);
}

export function resequence(
  combinations: EngineCombination[],
): EngineCombination[] {
  const next = new Map<string, number>();
  const physical = (key: string) => key.slice(0, key.lastIndexOf(":"));
  return combinations.map((c) => {
    const machine = physical(c.machineKey);
    const sequence = (next.get(machine) ?? 0) + 1;
    next.set(machine, sequence);
    return { ...c, sequence };
  });
}

/**
 * Solver.CargarCombinaciones + RedondearMetros (Solver.cs:410-443): keep
 * X_k > minMeters ∧ X_k > roundingFactor/2, round (D-12: whole metres), drop
 * runs that round to 0 (D-40), then sequence per physical machine — reel width
 * descending, candidate order within a width (D-42).
 */
export function loadSolution(
  input: EngineInput,
  candidates: Candidate[],
  x: number[],
): EngineCombination[] {
  const p = input.parameters;
  const kept: Array<{ candidate: Candidate; meters: number; index: number }> =
    [];
  candidates.forEach((candidate, index) => {
    const value = x[index] ?? 0;
    if (!(value > p.minMeters && value > p.roundingFactor / 2)) return;
    const meters =
      p.roundingFactor > 1
        ? roundToStep(value, p.roundingFactor)
        : roundHalfUpInt(value);
    if (meters <= 0) return;
    kept.push({ candidate, meters, index });
  });
  const machineOrder = input.machines
    .map((m) => m.machineUuid)
    .filter((u, i, a) => a.indexOf(u) === i);
  kept.sort((a, b) => {
    const ma = machineOf(input, a.candidate.machineKey);
    const mb = machineOf(input, b.candidate.machineKey);
    const byMachine =
      machineOrder.indexOf(ma.machineUuid) -
      machineOrder.indexOf(mb.machineUuid);
    if (byMachine !== 0) return byMachine;
    if (ma.width !== mb.width) return mb.width - ma.width;
    return a.index - b.index;
  });
  return resequence(
    kept.map(({ candidate, meters }) => ({
      machineKey: candidate.machineKey,
      items: candidate.items.map((it) => ({ ...it })),
      sequence: 0,
      meters,
    })),
  );
}
