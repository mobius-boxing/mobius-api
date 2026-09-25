import path from "path";
import { Worker } from "worker_threads";
import { runPipeline } from "./pipeline";
import { EngineInput, SolveOutcome } from "./types";

export interface SolveHandle {
  /** Resolves once; never rejects (errors become status 'error'). */
  result: Promise<SolveOutcome>;
  /** Terminates the worker; `result` then resolves with status 'cancelled'. */
  cancel(): void;
}

let running = 0;

/** Number of solves currently running in this process (for the SOLVER_BUSY cap). */
export function runningSolves(): number {
  return running;
}

// Under nodemon/ts-jest this module is TypeScript, so the worker must register ts-node itself.
const isTs = path.extname(__filename) === ".ts";
const workerFile = path.join(__dirname, `worker${isTs ? ".ts" : ".js"}`);
const workerExecArgv = isTs
  ? ["-r", "ts-node/register/transpile-only"]
  : undefined;

/** Runs enumerate → buildModel → HiGHS → load in a worker_thread. */
export function startSolve(input: EngineInput): SolveHandle {
  running++;
  const worker = new Worker(workerFile, {
    workerData: input,
    execArgv: workerExecArgv,
  });
  let cancelled = false;
  let settle!: (outcome: SolveOutcome) => void;
  const result = new Promise<SolveOutcome>((resolve) => {
    let done = false;
    settle = (outcome) => {
      if (done) return;
      done = true;
      running--;
      clearTimeout(watchdog);
      resolve(outcome);
      void worker.terminate();
    };
  });
  const failed = (log: string): SolveOutcome => ({
    status: cancelled ? "cancelled" : "error",
    combinations: [],
    combinationsGenerated: 0,
    log,
  });
  // The solver honours its own time limit; this only catches a wedged worker.
  const watchdog = setTimeout(
    () => settle(failed("Solve worker did not finish in time and was stopped")),
    (Math.max(1, input.parameters.timeLimitSeconds) * 2 + 60) * 1000,
  );
  watchdog.unref();
  worker.once("message", (outcome: SolveOutcome) =>
    settle(cancelled ? failed("Cancelled") : outcome),
  );
  worker.once("error", (e) =>
    settle(failed(`Solve worker error: ${e.message}`)),
  );
  worker.once("exit", (code) =>
    settle(
      failed(cancelled ? "Cancelled" : `Solve worker exited with code ${code}`),
    ),
  );
  return {
    result,
    cancel() {
      cancelled = true;
      settle(failed("Cancelled"));
    },
  };
}

/** Same pipeline on the calling thread (tests, tiny instances). */
export function solveInline(input: EngineInput): Promise<SolveOutcome> {
  return runPipeline(input);
}
