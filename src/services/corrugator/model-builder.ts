import { lanesOf, linearProduction, trimOf, wasteLinear } from "./geometry";
import { Candidate, EngineInput, EngineOrder } from "./types";

/**
 * MIP in CPLEX-LP text (the format Pandora's Modelo.EscribirLP writes and
 * HiGHS reads). Tier-1 families of pandora-breakdown Appendix A §2.3:
 * C1/C2 demand with V/W slacks, C4 all-or-nothing, C5 minimum run (§4.19 fix),
 * C11 format minimum (D-13), Refile objective. Two-sided rows are written as
 * two rows.
 */

export interface MipModel {
  lp: string;
  columns: number;
  rows: number;
  xNames: string[]; // x-variable name per candidate index
}

/** Pedido.CantidadInferior / CantidadSuperior (Pedido.cs:301-309). */
export function orderBounds(
  order: EngineOrder,
  input: EngineInput,
): { lower: number; upper: number } {
  const p = input.parameters;
  const excess = 1 + p.excessFactor / 100;
  const tol = p.toleranceQuantities ? 1 : 0;
  const lower =
    order.priority === "optional"
      ? 0
      : order.quantity * (1 - (tol * order.underrunPercentage) / 100) * excess;
  const upper =
    order.quantity * (1 + (tol * order.overrunPercentage) / 100) * excess;
  return { lower, upper };
}

const num = (x: number): string => {
  if (!Number.isFinite(x)) throw new Error(`Non-finite coefficient ${x}`);
  return Number.isInteger(x)
    ? String(x)
    : x.toPrecision(15).replace(/\.?0+(e|$)/, "$1");
};

function linear(terms: Array<[number, string]>): string {
  const parts: string[] = [];
  for (const [coef, name] of terms) {
    if (coef === 0) continue;
    const sign = coef < 0 ? "-" : "+";
    const abs = Math.abs(coef);
    parts.push(
      `${parts.length === 0 && sign === "+" ? "" : `${sign} `}${abs === 1 ? "" : `${num(abs)} `}${name}`,
    );
  }
  return parts.length ? parts.join(" ") : "0 x0";
}

export function buildModel(
  input: EngineInput,
  candidates: Candidate[],
): MipModel {
  const p = input.parameters;
  const machinesByKey = new Map(input.machines.map((m) => [m.key, m]));
  const lanes = candidates.map((c) => lanesOf(input, c.items));
  const xNames = candidates.map((_, k) => `x${k}`);

  // L_k(p): sheets of order p per metre of candidate k.
  const production: Array<Map<string, number>> = lanes.map((ls) => {
    const map = new Map<string, number>();
    for (const l of ls)
      map.set(l.orderKey, (map.get(l.orderKey) ?? 0) + linearProduction(l));
    return map;
  });
  const bounds = input.orders.map((o) => orderBounds(o, input));

  const objective: Array<[number, string]> = [];
  const rows: string[] = [];
  const binaries: string[] = [];
  const nonNegative: string[] = [];
  let columns = candidates.length;

  candidates.forEach((c, k) => {
    const m = machinesByKey.get(c.machineKey);
    if (!m) throw new Error(`Unknown machine ${c.machineKey}`);
    const waste = wasteLinear(m.width, trimOf(lanes[k]), input.grammage) ?? 0;
    objective.push([waste, xNames[k]]);
  });

  input.orders.forEach((order, i) => {
    const terms: Array<[number, string]> = [];
    production.forEach((map, k) => {
      const l = map.get(order.key);
      if (l) terms.push([l, xNames[k]]);
    });
    const { lower, upper } = bounds[i];
    const mandatory = order.priority === "mandatory";
    const lowerTerms = [...terms];
    if (p.constraints.violationLower) {
      lowerTerms.push([1, `v${i}`]);
      objective.push([
        mandatory ? p.costViolationLowerMandatory : p.costViolationLower,
        `v${i}`,
      ]);
      nonNegative.push(`v${i}`);
      columns++;
    }
    rows.push(`dlo${i}: ${linear(lowerTerms)} >= ${num(lower)}`);
    const upperTerms = [...terms];
    if (p.constraints.violationUpper) {
      upperTerms.push([-1, `w${i}`]);
      objective.push([
        mandatory ? p.costViolationUpperMandatory : p.costViolationUpper,
        `w${i}`,
      ]);
      nonNegative.push(`w${i}`);
      columns++;
    }
    rows.push(`dhi${i}: ${linear(upperTerms)} <= ${num(upper)}`);

    // C4 PedidoMinimo.cs:24-52 — P=1 ⇒ lower ≤ production ≤ 3·upper; P=0 ⇒ production = 0.
    if (
      p.constraints.conditionalProduction &&
      !order.partialProduction &&
      terms.length
    ) {
      const big = 3 * upper;
      binaries.push(`p${i}`);
      columns++;
      rows.push(`aon${i}a: ${linear([...terms, [-big, `p${i}`]])} <= 0`);
      rows.push(
        `aon${i}b: ${linear([...terms, [-big, `p${i}`]])} >= ${num(lower - big)}`,
      );
    }
  });

  // C5 minimum run (§4.19): X_k ≤ U_k·Y_k and X_k ≥ minRun·Y_k.
  if (p.constraints.minRun && p.minRunLength > 0) {
    lanes.forEach((ls, k) => {
      const maxRun = Math.max(
        0,
        ...ls.map((l) => {
          const i = input.orders.findIndex((o) => o.key === l.orderKey);
          return (bounds[i].upper * l.runLength) / (1000 * l.count);
        }),
      );
      const u = Math.max(maxRun, p.minRunLength);
      binaries.push(`y${k}`);
      columns++;
      rows.push(
        `run${k}a: ${linear([
          [1, xNames[k]],
          [-u, `y${k}`],
        ])} <= 0`,
      );
      rows.push(
        `run${k}b: ${linear([
          [1, xNames[k]],
          [-p.minRunLength, `y${k}`],
        ])} >= 0`,
      );
    });
  }

  // C11 format minimum per distinct reel width (D-13: big-M in metres).
  if (p.constraints.minFormat && p.minFormatLength > 0) {
    const widths = Array.from(
      new Set(candidates.map((c) => machinesByKey.get(c.machineKey)!.width)),
    );
    widths.forEach((w, a) => {
      const ks = candidates
        .map((c, k) => ({ c, k }))
        .filter(({ c }) => machinesByKey.get(c.machineKey)!.width === w);
      const maxRuns = ks.reduce((acc, { k }) => {
        const run = Math.max(
          0,
          ...lanes[k].map((l) => {
            const i = input.orders.findIndex((o) => o.key === l.orderKey);
            return (bounds[i].upper * l.runLength) / (1000 * l.count);
          }),
        );
        return acc + run;
      }, 0);
      const u = Math.max(p.minFormatLength, maxRuns);
      const terms: Array<[number, string]> = ks.map(({ k }) => [1, xNames[k]]);
      binaries.push(`f${a}`);
      columns++;
      objective.push([p.costFormatChange, `f${a}`]);
      rows.push(`fmt${a}a: ${linear([...terms, [-u, `f${a}`]])} <= 0`);
      rows.push(
        `fmt${a}b: ${linear([...terms, [-u, `f${a}`]])} >= ${num(p.minFormatLength - u)}`,
      );
    });
  }

  const lp = [
    "Minimize",
    ` obj: ${linear(objective)}`,
    "Subject To",
    ...rows.map((r) => ` ${r}`),
    "Bounds",
    ...xNames.map((x) => ` ${x} >= 0`),
    ...nonNegative.map((v) => ` ${v} >= 0`),
    ...(binaries.length ? ["Binary", ...binaries.map((b) => ` ${b}`)] : []),
    "End",
    "",
  ].join("\n");

  return { lp, columns, rows: rows.length, xNames };
}
