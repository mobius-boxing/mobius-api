import { randomUUID } from "crypto";
import { NfDocumentDAO } from "../../dao/node-files/nf-document.dao";
import {
  INodeFilesLockCandidate,
  NfRunDAO,
} from "../../dao/node-files/nf-run.dao";
import { NfWorkflowDAO } from "../../dao/node-files/nf-workflow.dao";
import { FileStorageService } from "../file-storage.service";
import { executeRun } from "./executor";
import { ClaudeExtractionProvider } from "./extraction/claude-extraction.provider";
import {
  ExtractionError,
  IExtractionProvider,
  IExtractionSettings,
  resolveExtractionSettings,
} from "./extraction/extraction-provider";
import { OpenAIExtractionProvider } from "./extraction/openai-extraction.provider";
import { missingRequiredLabels } from "./extraction/field-schema";

/**
 * The worker: claim one queued run, extract it, then walk its node graph.
 *
 * The house rule this file exists to respect: **external I/O never happens
 * inside a transaction.** The claim is one short statement of its own; the
 * connection is back in the pool before a single byte is fetched, before the
 * LLM call, and the result is written by a second short statement afterwards.
 * The `nodefiles` pool has 5 connections — holding one across a call that can
 * take minutes would starve the module's entire HTTP surface.
 *
 * The countdown reminder scheduler is the lifecycle precedent (interval, boot
 * delay, `.unref()` on both, a re-entrancy guard, started from server.ts and
 * stopped in shutdown). Its *claim* mechanism is not: a calendar-day row cannot
 * express "one worker at a time per run", which is what SKIP LOCKED does.
 *
 * Phase 2 gives the tick a second half. A run reaches the executor by one of
 * exactly two routes — the two hand-off points of brief D-1 — and BOTH are
 * wired here:
 *
 *   `requireReview: false` → extraction ends in `running` and this same tick
 *                            executes the graph, still holding its own claim.
 *   `requireReview: true`  → extraction ends in `pending_review`; `POST /review`
 *                            moves the run to `running` and UNLOCKS it, and
 *                            `processNextExecution` claims it on a later tick.
 *
 * Missing either one leaves a whole class of run that quietly never executes
 * its nodes, which is precisely what Phase 1 did to every workflow with a graph.
 */

/** How often the worker looks for work. */
export const NF_WORKER_TICK_MS = 5_000;

/** A short delay on boot so a deploy does not extract while migrations settle. */
export const NF_WORKER_BOOT_DELAY_MS = 15_000;

/**
 * Wall-clock cap on a claim. A process killed mid-extraction leaves its run in
 * `extracting` with nobody working on it; past this, the run is nobody's and
 * goes back in the queue. Comfortably above the provider's own 5-minute client
 * timeout, so a slow-but-alive extraction is never stolen from itself.
 */
export const NF_LOCK_CAP_MS = 10 * 60 * 1000;

/**
 * Is this claim abandoned? The single definition of "stale", kept out of SQL so
 * it can be tested without a database and so the sweep cannot drift from it.
 *
 * A row in `extracting` with NO `lockedAt` is stale by definition: the claim
 * always sets both, so its absence means the row was left inconsistent and
 * nothing is ever going to finish it. The comparison is strictly-greater on
 * age, so a run claimed exactly at the cap is left alone for one more tick —
 * requeueing a run that might still be alive risks paying for the same
 * extraction twice.
 */
export function isStaleLock(
  lockedAt: Date | string | null,
  now: Date,
  capMs: number = NF_LOCK_CAP_MS,
): boolean {
  if (lockedAt === null) return true;
  const claimedAt =
    lockedAt instanceof Date
      ? lockedAt.getTime()
      : new Date(lockedAt).getTime();
  // An unparseable timestamp is not evidence that the run is alive.
  if (Number.isNaN(claimedAt)) return true;
  return now.getTime() - claimedAt > capMs;
}

/** The ids to put back in the queue, given every currently-held run. */
export function staleRunIds(
  candidates: INodeFilesLockCandidate[],
  now: Date,
  capMs: number = NF_LOCK_CAP_MS,
): number[] {
  return candidates
    .filter((candidate) => isStaleLock(candidate.lockedAt, now, capMs))
    .map((candidate) => candidate.id);
}

const runDAO = new NfRunDAO();
const workflowDAO = new NfWorkflowDAO();
const documentDAO = new NfDocumentDAO();
const storage = new FileStorageService();

/** Identifies this process in `lockedBy` — useful when a lock outlives a deploy. */
const WORKER_ID = `nf-${process.pid}-${randomUUID().slice(0, 8)}`;

/** Overridable so tests and future phases can swap the provider. */
type ProviderFactory = (companyId: number) => Promise<IExtractionProvider>;

/**
 * Settings → provider. Exhaustive by construction: the switch returns on every
 * member of the union, so adding a third vendor to
 * `NodeFilesExtractionProvider` is a compile error here rather than a silent
 * fall-through to whichever one happens to be listed last.
 */
export function providerFor(
  settings: IExtractionSettings,
): IExtractionProvider {
  switch (settings.provider) {
    case "claude":
      return new ClaudeExtractionProvider(settings);
    case "openai":
      return new OpenAIExtractionProvider(settings);
  }
}

const defaultProviderFactory: ProviderFactory = async (companyId) =>
  providerFor(await resolveExtractionSettings(companyId));

/** Put abandoned claims back in the queue. Returns how many moved. */
export async function sweepStaleLocks(now: Date = new Date()): Promise<number> {
  const candidates = await runDAO.listExtracting();
  const ids = staleRunIds(candidates, now);
  if (ids.length === 0) return 0;
  const requeued = await runDAO.requeue(ids);
  if (requeued > 0) {
    console.warn(`[node-files] requeued ${requeued} abandoned run(s)`);
  }
  return requeued;
}

/**
 * The same staleness rule applied to abandoned EXECUTIONS — with the opposite
 * recovery, deliberately.
 *
 * An abandoned extraction is requeued: re-reading a document costs money but
 * changes nothing outside the module. An abandoned execution is FAILED: its
 * dead worker may already have sent an email and called an external API, and
 * nothing in the row records exactly how far it got. Re-running would repeat
 * those side effects; failing it tells the truth and leaves "reintentar" to a
 * human who can look at the node timeline first.
 */
export async function sweepAbandonedExecutions(
  now: Date = new Date(),
): Promise<number> {
  const candidates = await runDAO.listRunningClaims();
  const ids = staleRunIds(candidates, now);
  if (ids.length === 0) return 0;
  const failed = await runDAO.failAbandonedExecutions(
    ids,
    "La ejecución se interrumpió; revisá los nodos ya ejecutados antes de reintentar",
  );
  if (failed > 0) {
    console.warn(`[node-files] failed ${failed} abandoned execution(s)`);
  }
  return failed;
}

/**
 * Claim and process ONE run. Returns whether there was anything to do, so a
 * caller can drain the queue without waiting for the next tick.
 *
 * Read the sequence as the transaction boundaries it is:
 *   1. claim         — one statement, its own transaction
 *   2. read metadata — short queries, no lock held
 *   3. fetch bytes   — external I/O, no DB connection held
 *   4. call provider — external I/O, no DB connection held
 *   5. record        — one short statement
 */
export async function processNextRun(
  providerFactory: ProviderFactory = defaultProviderFactory,
): Promise<boolean> {
  const claim = await runDAO.claimNext(WORKER_ID);
  if (!claim) return false;

  try {
    // Everything from here is scoped to the claimed run's OWN company (L-009):
    // the claim is process-wide, the work never is.
    const [workflow, document] = await Promise.all([
      workflowDAO.getById(claim.workflowId, claim.companyId),
      documentDAO.getById(claim.documentId, claim.companyId),
    ]);
    if (!workflow) throw new ExtractionError("El flujo ya no existe");
    if (!document) throw new ExtractionError("El documento ya no existe");
    if (workflow.fields.length === 0) {
      throw new ExtractionError("El flujo no declara campos a extraer");
    }

    const bytes = await storage.getObjectBuffer(document.storageKey);
    const provider = await providerFactory(claim.companyId);
    const result = await provider.extract({
      fields: workflow.fields,
      bytes,
      contentType: document.contentType,
      originalName: document.originalName,
    });

    const missing = missingRequiredLabels(workflow.fields, result.values);
    if (missing.length > 0) {
      // Recorded as a failure, but with the values kept out of the way: a run
      // that is missing what the user declared obligatory did not succeed, and
      // "retry" is the honest next step.
      await runDAO.markFailed(
        claim.id,
        claim.companyId,
        `No se encontraron campos obligatorios: ${missing.join(", ")}`,
      );
      return true;
    }

    // **Hand-off point one** (brief D-1). This used to be
    // `requireReview ? "pending_review" : "succeeded"`, and "succeeded" was
    // where every non-reviewed run stopped forever: extraction finished, the
    // node graph never ran, and nothing anywhere said so.
    const nextStatus = workflow.requireReview ? "pending_review" : "running";
    await runDAO.markFinished(claim.id, claim.companyId, {
      status: nextStatus,
      extracted: result.values,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    console.info(
      `[node-files] run ${claim.uuid} extracted → ${nextStatus} ` +
        `tokensIn=${result.tokensIn} tokensOut=${result.tokensOut}`,
    );

    // Executed in THIS tick, still under this worker's claim: `markFinished`
    // kept `lockedBy`, so no other worker can pick the run up and run every
    // node a second time. The claim is a row flag, not a held connection —
    // nothing below holds one while a node is working.
    if (nextStatus === "running") {
      await executeRun(claim);
    }
    return true;
  } catch (err) {
    // An ExtractionError's message is written for the tenant; anything else is
    // a bug or an outage and gets a generic message, with the detail in the log.
    const message =
      err instanceof ExtractionError
        ? err.message
        : "Error inesperado durante la extracción";
    if (!(err instanceof ExtractionError)) {
      console.error(
        `[node-files] run ${claim.uuid} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    await runDAO
      .markFailed(claim.id, claim.companyId, message)
      .catch((markErr: unknown) => {
        // The stale-lock sweep is the net under this: the run stays in
        // `extracting` and comes back to the queue on its own.
        console.error(
          `[node-files] could not record failure for run ${claim.uuid}:`,
          markErr instanceof Error ? markErr.message : markErr,
        );
      });
    return true;
  }
}

/**
 * **Hand-off point two** (brief D-1): claim one run that is `running` and
 * unlocked — which is what `POST /review` leaves behind — and execute it.
 *
 * Returns whether there was anything to do.
 */
export async function processNextExecution(): Promise<boolean> {
  const claim = await runDAO.claimNextRunnable(WORKER_ID);
  if (!claim) return false;

  try {
    await executeRun(claim);
  } catch (err) {
    // `executeRun` handles its own node failures; reaching here means the
    // executor itself broke, and the run must not be left locked forever.
    console.error(
      `[node-files] execution of run ${claim.uuid} crashed:`,
      err instanceof Error ? err.message : err,
    );
    await runDAO
      .finishExecution(
        claim.id,
        claim.companyId,
        "failed",
        "Error inesperado al ejecutar el flujo",
      )
      .catch((markErr: unknown) => {
        console.error(
          `[node-files] could not record failure for run ${claim.uuid}:`,
          markErr instanceof Error ? markErr.message : markErr,
        );
      });
  }
  return true;
}

let running = false;
let timer: NodeJS.Timeout | null = null;

/**
 * One extraction and one execution per tick, never two at a time in one
 * process: `running` is the re-entrancy guard, and a tick that overruns simply
 * skips the next one.
 */
export function startNodeFilesWorker(): void {
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await sweepStaleLocks();
      await sweepAbandonedExecutions();
      await processNextRun();
      // Both hand-off points, every tick: the extraction path (above, which
      // executes inline) and the review path (here).
      await processNextExecution();
    } catch (err) {
      // A worker that throws takes the process down with it; log and wait for
      // the next tick instead.
      console.error(
        "[node-files] worker tick failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), NF_WORKER_BOOT_DELAY_MS).unref();
  timer = setInterval(() => void tick(), NF_WORKER_TICK_MS);
  // Unref'd: a pending timer must never be the reason the process won't exit.
  timer.unref();
}

export function stopNodeFilesWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
