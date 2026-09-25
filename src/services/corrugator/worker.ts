import { parentPort, workerData } from "worker_threads";
import { runPipeline } from "./pipeline";
import { EngineInput } from "./types";

void runPipeline(workerData as EngineInput).then((outcome) =>
  parentPort?.postMessage(outcome),
);
