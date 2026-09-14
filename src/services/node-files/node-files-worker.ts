import { randomUUID } from "crypto";
import { NfDocumentDAO } from "../../dao/node-files/nf-document.dao";
import {
  INodeFilesLockCandidate,
  NfRunDAO,
} from "../../dao/node-files/nf-run.dao";
import { NfWorkflowDAO } from "../../dao/node-files/nf-workflow.dao";
import { withAuditContext } from "../../database/audit-context";
import { withTenant } from "../../database/registry";
import { CoreClient } from "../core-client.service";
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

/**
 * Who the ledger says wrote this worker's rows (audit P2). Contractual: the
 * trigger stores `source` and `username` verbatim and the history UI shows
 * them.
 *
 * **Where it may and may not be used** (ruling R-C). `withAuditContext` arms
 * the ambient state, which means everything inside it runs in ONE transaction —
 * so it may only ever wrap the short database steps below. It is never wrapped
 * around `storage.getObjectBuffer`, `provider.extract` or `executeRun`: those
 * are the LLM/HTTP/e-mail calls this file's header comment promises never to
 * hold a connection across, on a pool of five.
 */
const NODE_FILES_JOB = {
  source: "job",
  username: "node-files-worker",
} as const;

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

/**
 * Put abandoned claims of `companyId`'s tenant back in the queue. Returns how
 * many moved.
 *
 * Wrapped whole because the whole of it is two short statements against
 * `nf_runs` and nothing else — no bytes, no provider, no node. db-per-company
 * (T8): every tenant's `nf_runs` now lives in its own database, so the sweep
 * runs once per active tenant, inside that company's own `withTenant` scope.
 */
export async function sweepStaleLocks(
  companyId: number,
  now: Date = new Date(),
): Promise<number> {
  return withTenant(companyId, () =>
    withAuditContext(NODE_FILES_JOB, async () => {
      const candidates = await runDAO.listExtracting();
      const ids = staleRunIds(candidates, now);
      if (ids.length === 0) return 0;
      const requeued = await runDAO.requeue(ids);
      if (requeued > 0) {
        console.warn(`[node-files] requeued ${requeued} abandoned run(s)`);
      }
      return requeued;
    }),
  );
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
  companyId: number,
  now: Date = new Date(),
): Promise<number> {
  // Wrapped whole, for the same reason as `sweepStaleLocks`: two short
  // statements against `nf_runs`, no external I/O anywhere inside — one
  // tenant's own database, per db-per-company (T8).
  return withTenant(companyId, () =>
    withAuditContext(NODE_FILES_JOB, async () => {
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
    }),
  );
}

/**
 * Claim and process ONE run of `companyId`'s tenant. Returns whether there was
 * anything to do, so a caller can drain the queue without waiting for the next
 * tick.
 *
 * Read the sequence as the transaction boundaries it is:
 *   1. claim         — one statement, its own `withTenant` scope
 *   2. read metadata — short queries, no lock held, its own `withTenant` scope
 *   3. fetch bytes   — external I/O, no DB connection held, NO tenant scope
 *   4. call provider — external I/O, no DB connection held, NO tenant scope
 *   5. record        — one short statement, its own `withTenant` scope
 *
 * db-per-company (T8, AC-48): each step that touches the database opens its
 * own short `withTenant(companyId, …)` scope rather than one scope spanning
 * the whole call — steps 3 and 4 must never run with a tenant scope active,
 * so the unit test can assert exactly that around the (mocked) provider call.
 *
 * **Deliberately NOT wrapped in `withAuditContext`** (audit P2, ruling R-C).
 * Steps 3 and 4 sit between the writes, so there is no region here that both
 * covers a write and excludes an external call. The rows this function writes
 * therefore reach the trigger with no context and are logged `source='sql'`
 * with a null actor — an accepted, documented gap, not an oversight. Pushing
 * the context down onto `markFinished` / `markFailed` is the follow-up; do that
 * rather than widening a wrapper up to here.
 */
export async function processNextRun(
  companyId: number,
  providerFactory: ProviderFactory = defaultProviderFactory,
): Promise<boolean> {
  const claim = await withTenant(companyId, () => runDAO.claimNext(WORKER_ID));
  if (!claim) return false;

  try {
    // Everything from here is scoped to the claimed run's OWN company (L-009):
    // the claim is per-tenant, but the DAO's own arguments are the belt.
    const [workflow, document] = await withTenant(companyId, () =>
      Promise.all([
        workflowDAO.getById(claim.workflowId, claim.companyId),
        documentDAO.getById(claim.documentId, claim.companyId),
      ]),
    );
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
      await withTenant(companyId, () =>
        runDAO.markFailed(
          claim.id,
          claim.companyId,
          `No se encontraron campos obligatorios: ${missing.join(", ")}`,
        ),
      );
      return true;
    }

    // **Hand-off point one** (brief D-1). This used to be
    // `requireReview ? "pending_review" : "succeeded"`, and "succeeded" was
    // where every non-reviewed run stopped forever: extraction finished, the
    // node graph never ran, and nothing anywhere said so.
    const nextStatus = workflow.requireReview ? "pending_review" : "running";
    await withTenant(companyId, () =>
      runDAO.markFinished(claim.id, claim.companyId, {
        status: nextStatus,
        extracted: result.values,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      }),
    );
    console.info(
      `[node-files] run ${claim.uuid} extracted → ${nextStatus} ` +
        `tokensIn=${result.tokensIn} tokensOut=${result.tokensOut}`,
    );

    // Executed in THIS tick, still under this worker's claim: `markFinished`
    // kept `lockedBy`, so no other worker can pick the run up and run every
    // node a second time. The claim is a row flag, not a held connection —
    // nothing below holds one while a node is working. `executeRun` reaches
    // `db("tenant")` many times as it walks the graph, so it is handed ONE
    // `withTenant` scope for its whole call rather than one per node — that is
    // still no connection held across a node's own HTTP/e-mail call, which is
    // this file's actual constraint (see the header and executor.ts's own).
    if (nextStatus === "running") {
      await withTenant(companyId, () => executeRun(claim));
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
    await withTenant(companyId, () =>
      runDAO.markFailed(claim.id, claim.companyId, message),
    ).catch((markErr: unknown) => {
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
 * **Hand-off point two** (brief D-1): claim one run of `companyId`'s tenant
 * that is `running` and unlocked — which is what `POST /review` leaves
 * behind — and execute it.
 *
 * Returns whether there was anything to do.
 *
 * **Not wrapped whole in `withAuditContext`** (audit P2, ruling R-C).
 * `executeRun` alternates node execution — HTTP requests, e-mail — with one
 * short INSERT per node, so an audit context arming the whole call would hold
 * a `nodefiles` connection across every node of the graph. The two short
 * audited database steps that live *here* are wrapped one at a time instead:
 * the claim, and the crash-path failure record. `executeRun`'s own writes stay
 * unattributed, exactly as `processNextRun`'s do. The `withTenant` scope
 * around `executeRun`, by contrast, holds no connection at all (db-per-company
 * T8) — it only routes `db("tenant")`, so wrapping the whole call is safe.
 */
export async function processNextExecution(
  companyId: number,
): Promise<boolean> {
  const claim = await withTenant(companyId, () =>
    withAuditContext(NODE_FILES_JOB, () => runDAO.claimNextRunnable(WORKER_ID)),
  );
  if (!claim) return false;

  try {
    // No audit context on purpose: this is the half that talks to the
    // network.
    await withTenant(companyId, () => executeRun(claim));
  } catch (err) {
    // `executeRun` handles its own node failures; reaching here means the
    // executor itself broke, and the run must not be left locked forever.
    console.error(
      `[node-files] execution of run ${claim.uuid} crashed:`,
      err instanceof Error ? err.message : err,
    );
    await withTenant(companyId, () =>
      withAuditContext(NODE_FILES_JOB, () =>
        runDAO.finishExecution(
          claim.id,
          claim.companyId,
          "failed",
          "Error inesperado al ejecutar el flujo",
        ),
      ),
    ).catch((markErr: unknown) => {
      console.error(
        `[node-files] could not record failure for run ${claim.uuid}:`,
        markErr instanceof Error ? markErr.message : markErr,
      );
    });
  }
  return true;
}

/**
 * Idle backoff ladder (model D-22, AC-48): the delay before the NEXT tick once
 * a whole round finds no work anywhere, 5 → 10 → 20 → 40 → 60 s, held at 60 s
 * after that. Resets to the first step the instant any tenant yields work —
 * T8/D-2 (doubling, capped at 60 s; the model only fixes the two ends).
 */
export const NF_WORKER_IDLE_BACKOFF_MS: readonly number[] = [
  5_000, 10_000, 20_000, 40_000, 60_000,
];

/**
 * The visiting order for one tick (AC-48): start right after the tenant that
 * yielded work last time, wrapping around `activeCompanyIds`. A tenant that
 * dropped out since (module disabled, no longer active) is simply absent —
 * `indexOf` returns -1 and the round starts from the top of the current list,
 * in its own order, rather than throwing or skipping the round.
 */
export function rotateTenants(
  activeCompanyIds: readonly number[],
  lastYielded: number | null,
): readonly number[] {
  if (activeCompanyIds.length === 0) return activeCompanyIds;
  const lastIndex =
    lastYielded === null ? -1 : activeCompanyIds.indexOf(lastYielded);
  if (lastIndex === -1) return activeCompanyIds;
  const startAt = (lastIndex + 1) % activeCompanyIds.length;
  return [
    ...activeCompanyIds.slice(startAt),
    ...activeCompanyIds.slice(0, startAt),
  ];
}

let lastYieldedCompanyId: number | null = null;

/** One tenant's whole tick: both sweeps, then both hand-off points. */
async function processTenantOnce(
  companyId: number,
  providerFactory: ProviderFactory,
): Promise<boolean> {
  await sweepStaleLocks(companyId);
  await sweepAbandonedExecutions(companyId);
  const extracted = await processNextRun(companyId, providerFactory);
  // Both hand-off points, every visit: the extraction path (above, which
  // executes inline) and the review path (here).
  const executed = await processNextExecution(companyId);
  return extracted || executed;
}

/**
 * One round-robin pass (model D-22, AC-48): visit active node-files tenants in
 * `rotateTenants` order, stopping at the first one that did anything and
 * remembering it so the next pass starts after it. A tenant whose scope
 * throws (suspended, unavailable, or any other error `withTenant` surfaces) is
 * logged and skipped — the round continues with the next tenant, exactly as
 * `CountdownRemindersService.run` treats a throwing company.
 *
 * Exported so a test (or a caller wanting to drain the queue faster than the
 * scheduler's own cadence) can drive one pass directly, with fake timers doing
 * nothing but advancing the clock between calls.
 */
export async function runNodeFilesWorkerTick(
  providerFactory: ProviderFactory = defaultProviderFactory,
): Promise<boolean> {
  const activeCompanyIds =
    await CoreClient.companyIdsWithModuleEnabled("node-files");
  const order = rotateTenants(activeCompanyIds, lastYieldedCompanyId);

  for (const companyId of order) {
    try {
      const didWork = await processTenantOnce(companyId, providerFactory);
      if (didWork) {
        lastYieldedCompanyId = companyId;
        return true;
      }
    } catch (err) {
      console.error(
        `[node-files] tenant ${companyId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return false;
}

/** Test-only: forget which tenant yielded last and reset the idle backoff. */
export function resetNodeFilesWorkerRoundRobinForTest(): void {
  lastYieldedCompanyId = null;
  idleBackoffIndex = 0;
}

let running = false;
let idleBackoffIndex = 0;
let stopped = true;
let timer: NodeJS.Timeout | null = null;

/**
 * Never two ticks at a time in one process: `running` is the re-entrancy
 * guard, and a tick that overruns simply delays the next one rather than
 * overlapping it.
 *
 * The schedule is a chain of `setTimeout`s, not a fixed `setInterval`,
 * because the delay itself varies: `NF_WORKER_TICK_MS` right after a tick that
 * found work (there may be more queued), the idle backoff ladder once a whole
 * round finds nothing anywhere.
 */
export function startNodeFilesWorker(): void {
  stopped = false;

  const scheduleNext = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delayMs);
    timer.unref();
  };

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    let foundWork = false;
    try {
      foundWork = await runNodeFilesWorkerTick();
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

    if (foundWork) {
      idleBackoffIndex = 0;
      scheduleNext(NF_WORKER_TICK_MS);
    } else {
      const delay = NF_WORKER_IDLE_BACKOFF_MS[idleBackoffIndex] as number;
      idleBackoffIndex = Math.min(
        idleBackoffIndex + 1,
        NF_WORKER_IDLE_BACKOFF_MS.length - 1,
      );
      scheduleNext(delay);
    }
  };

  // Unref'd: a pending timer must never be the reason the process won't exit.
  timer = setTimeout(() => void tick(), NF_WORKER_BOOT_DELAY_MS);
  timer.unref();
}

export function stopNodeFilesWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
