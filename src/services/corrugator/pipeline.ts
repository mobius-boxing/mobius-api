import { enumerate } from "./combinator";
import { solveModel } from "./highs-solver";
import { buildModel } from "./model-builder";
import { loadSolution } from "./solution";
import { EngineInput, SolveOutcome } from "./types";

/** Embedded-solver size gate (C-6): larger models fail fast instead of exhausting the worker. */
export const MAX_COLUMNS = 20000;
export const MAX_ROWS = 40000;
const MAX_LOG = 20000;

/** enumerate → buildModel → size gate → HiGHS → load. Never throws. */
export async function runPipeline(input: EngineInput): Promise<SolveOutcome> {
  const log: string[] = [];
  const outcome = (
    status: SolveOutcome["status"],
    combinations: SolveOutcome["combinations"],
    generated: number,
  ) => ({
    status,
    combinations,
    combinationsGenerated: generated,
    log: log.join("\n").slice(0, MAX_LOG),
  });
  try {
    const budgetMs = Math.max(1, input.parameters.timeLimitSeconds) * 1000;
    const enumeration = enumerate(input, Math.min(budgetMs, 120000));
    log.push(
      `Enumeration: ${enumeration.status}, ${enumeration.generated} combinations for ${input.orders.length} orders on ${input.machines.length} machine formats in ${enumeration.elapsedMs} ms` +
        (enumeration.reason ? ` (${enumeration.reason})` : ""),
    );
    if (enumeration.status !== "ok")
      return outcome(enumeration.status, [], enumeration.generated);

    const model = buildModel(input, enumeration.candidates);
    log.push(`Model: ${model.columns} columns, ${model.rows} rows`);
    if (model.columns > MAX_COLUMNS || model.rows > MAX_ROWS) {
      log.push(
        `Model exceeds the embedded solver limit (${MAX_COLUMNS} columns / ${MAX_ROWS} rows)`,
      );
      return outcome("too-large", [], enumeration.generated);
    }

    const remaining = Math.max(1, (budgetMs - enumeration.elapsedMs) / 1000);
    const result = await solveModel(model, {
      maxGap: input.parameters.maxGap,
      timeLimitSeconds: remaining,
    });
    log.push(result.log);
    if (result.status === "infeasible")
      return outcome("infeasible", [], enumeration.generated);
    if (result.status === "error")
      return outcome("error", [], enumeration.generated);

    const combinations = loadSolution(input, enumeration.candidates, result.x);
    const used = result.x.filter((v) => v > 1e-6).length;
    log.push(
      `Load: ${used} combinations used by the solver, ${combinations.length} kept after thresholds and rounding`,
    );
    return outcome(
      result.status === "optimal" ? "ok" : "time-limit",
      combinations,
      enumeration.generated,
    );
  } catch (e) {
    log.push(`Error: ${(e as Error).stack ?? (e as Error).message}`);
    return outcome("error", [], 0);
  }
}
