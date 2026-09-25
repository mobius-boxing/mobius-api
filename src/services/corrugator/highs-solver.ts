import highsLoader from "highs";
import { MipModel } from "./model-builder";

export interface SolveResult {
  status: "optimal" | "feasible-time-limit" | "infeasible" | "error";
  x: number[]; // X_k per candidate (metres), empty unless a solution exists
  objective: number | null;
  log: string;
}

/**
 * One HiGHS WASM solve. `highs.solve` blocks its thread, so callers run this
 * inside the solve worker; every call loads a fresh runtime (U-6).
 */
export async function solveModel(
  model: MipModel,
  opts: { maxGap: number; timeLimitSeconds: number },
): Promise<SolveResult> {
  let highs;
  try {
    highs = await highsLoader();
  } catch (e) {
    return {
      status: "error",
      x: [],
      objective: null,
      log: `HiGHS failed to load: ${(e as Error).message}`,
    };
  }
  let solution;
  try {
    solution = highs.solve(model.lp, {
      time_limit: Math.max(1, opts.timeLimitSeconds),
      mip_rel_gap: Math.max(0, opts.maxGap) / 100,
      output_flag: false,
    });
  } catch (e) {
    return {
      status: "error",
      x: [],
      objective: null,
      log: `HiGHS error: ${(e as Error).message}`,
    };
  }
  const status = solution.Status as string;
  const columns = solution.Columns as Record<string, { Primal?: number }>;
  const hasPrimal = model.xNames.every(
    (n) => typeof columns?.[n]?.Primal === "number",
  );
  const x = hasPrimal
    ? model.xNames.map((n) => columns[n].Primal as number)
    : [];
  const log = `HiGHS status: ${status}; objective: ${solution.ObjectiveValue}`;

  if (status === "Optimal")
    return { status: "optimal", x, objective: solution.ObjectiveValue, log };
  if (
    status === "Time limit reached" &&
    hasPrimal &&
    Number.isFinite(solution.ObjectiveValue)
  ) {
    return {
      status: "feasible-time-limit",
      x,
      objective: solution.ObjectiveValue,
      log,
    };
  }
  if (status === "Infeasible" || status === "Primal infeasible or unbounded") {
    return { status: "infeasible", x: [], objective: null, log };
  }
  return { status: "error", x: [], objective: null, log };
}
