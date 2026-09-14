/**
 * Audit attribution for the two background jobs (audit P2, track T3b).
 *
 * A job has no HTTP request, so nothing arms `mobius.audit` for it and every
 * row it writes would land `source='sql'` with a null actor.
 * `withAuditContext({source:'job', …})` fixes that — but it ARMS the ambient
 * state, which means everything inside it runs in one Postgres transaction.
 *
 * **The load-bearing assertions in this file are the negative ones**: that
 * `sendModuleEmail`, `provider.extract`, `storage.getObjectBuffer` and
 * `executeRun` each observe NO armed context. They are what ruling R-C reduces
 * to in code — widen any wrapper until it encloses one of those calls and this
 * file goes red, which is the whole point of writing them down. The positive
 * assertions (`source`, `username`) are a contract with the trigger, which
 * stores both verbatim.
 *
 * Every DAO is mocked, so no wrapped region ever calls `db()` and no
 * transaction is opened: the jobs are exercised for their *boundaries*, not for
 * their SQL.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  getAuditState,
  isAmbientAuditActive,
  type AuditRequestState,
} from "../../../database/audit-context";
import type {
  ICountdownDueDocumentRow,
  ICountdownReminderRecipient,
} from "../../../dao/countdown/countdown-reminder.dao";
import type { ICountdownReminderOutcome } from "../../../interfaces/countdown/countdown.interfaces";
import type { INodeFilesLockCandidate } from "../../../dao/node-files/nf-run.dao";
import type { INodeFilesClaimedRun } from "../../../interfaces/node-files/node-files.interfaces";
import type { IModuleEmail } from "../../../services/module-email.service";

/**
 * db-per-company (T8): both jobs now iterate `CoreClient.companyIdsWithModuleEnabled`
 * and run each company inside `withTenant`. Every fixture here belongs to
 * company 2 (`CLAIM.companyId`, `dueRow().companyId`, `recipient().companyId`),
 * so both modules resolve to exactly one tenant and the R-C boundary
 * assertions this file exists for are otherwise unaffected: `withTenant` is
 * mocked to run its callback in place, with no ALS scope and no audit
 * ambient state of its own to interfere with `observe()`.
 */
const FIXTURE_COMPANY_ID = 2;

jest.mock("../../../database/registry", () => ({
  withTenant: <T>(_companyId: number, fn: () => Promise<T>) => fn(),
}));

jest.mock("../../../services/core-client.service", () => ({
  CoreClient: {
    companyIdsWithModuleEnabled: async () => [FIXTURE_COMPANY_ID],
  },
}));

/**
 * What the ledger would record if this call wrote a row: the armed state, or
 * `null` for "no context, `source='sql'`". Captured at call time because the
 * state is ambient and gone by the time an assertion could look for it.
 */
type Observed = { source: string; username: string | null } | null;

const observe = (): Observed => {
  const state = getAuditState();
  // Not merely "a state exists": an unarmed state writes nothing either.
  if (!isAmbientAuditActive(state)) return null;
  const armed: AuditRequestState = state;
  return { source: armed.source, username: armed.actor?.username ?? null };
};

const JOB_REMINDERS = { source: "job", username: "countdown-reminders" };
const JOB_WORKER = { source: "job", username: "node-files-worker" };

// ---------------------------------------------------------------------------
// countdown reminders
// ---------------------------------------------------------------------------

const seen: Record<string, Observed[]> = {};
const record = (label: string): void => {
  (seen[label] ??= []).push(observe());
};

const mockClaimToday =
  jest.fn<(today: string) => Promise<number | undefined>>();
const mockRecordOutcome =
  jest.fn<
    (runId: number, outcome: ICountdownReminderOutcome) => Promise<void>
  >();
const mockFindDue =
  jest.fn<
    (companyId: number, today: string) => Promise<ICountdownDueDocumentRow[]>
  >();
const mockFindRecipients =
  jest.fn<(userIds: number[]) => Promise<ICountdownReminderRecipient[]>>();
const mockSendModuleEmail =
  jest.fn<(email: IModuleEmail) => Promise<boolean>>();

// Methods, never property initialisers: the service module constructs one
// instance of itself at import time.
jest.mock("../../../dao/countdown/countdown-reminder.dao", () => ({
  CountdownReminderDAO: class {
    claimToday(today: string) {
      record("claimToday");
      return mockClaimToday(today);
    }
    recordOutcome(runId: number, outcome: ICountdownReminderOutcome) {
      record("recordOutcome");
      return mockRecordOutcome(runId, outcome);
    }
    findDue(companyId: number, today: string) {
      record("findDue");
      return mockFindDue(companyId, today);
    }
    findDigestedUserIds() {
      return Promise.resolve(new Set<number>());
    }
    findRecipients(userIds: number[]) {
      return mockFindRecipients(userIds);
    }
    findCompanyRecipientIds() {
      return Promise.resolve(new Map<number, number[]>());
    }
    recordDigest() {
      record("recordDigest");
      return Promise.resolve();
    }
  },
}));

jest.mock("../../../dao/countdown/countdown-assignment.dao", () => ({
  CountdownAssignmentDAO: class {
    effectiveUserIds(documentIds: number[]) {
      return Promise.resolve(
        new Map(documentIds.map((id) => [id, new Set([7])])),
      );
    }
  },
}));

jest.mock("../../../services/module-email.service", () => ({
  sendModuleEmail: (email: IModuleEmail) => {
    record("sendModuleEmail");
    return mockSendModuleEmail(email);
  },
}));

// ---------------------------------------------------------------------------
// node-files worker
// ---------------------------------------------------------------------------

const mockListExtracting = jest.fn<() => Promise<INodeFilesLockCandidate[]>>();
const mockRequeue = jest.fn<(ids: number[]) => Promise<number>>();
const mockListRunningClaims =
  jest.fn<() => Promise<INodeFilesLockCandidate[]>>();
const mockFailAbandoned =
  jest.fn<(ids: number[], message: string) => Promise<number>>();
const mockClaimNext =
  jest.fn<(lockedBy: string) => Promise<INodeFilesClaimedRun | null>>();
const mockClaimNextRunnable =
  jest.fn<(lockedBy: string) => Promise<INodeFilesClaimedRun | null>>();
const mockExecuteRun = jest.fn<() => Promise<void>>();

jest.mock("../../../dao/node-files/nf-run.dao", () => ({
  NfRunDAO: class {
    listExtracting() {
      record("listExtracting");
      return mockListExtracting();
    }
    requeue(ids: number[]) {
      record("requeue");
      return mockRequeue(ids);
    }
    listRunningClaims() {
      record("listRunningClaims");
      return mockListRunningClaims();
    }
    failAbandonedExecutions(ids: number[], message: string) {
      record("failAbandonedExecutions");
      return mockFailAbandoned(ids, message);
    }
    claimNext(lockedBy: string) {
      record("claimNext");
      return mockClaimNext(lockedBy);
    }
    claimNextRunnable(lockedBy: string) {
      record("claimNextRunnable");
      return mockClaimNextRunnable(lockedBy);
    }
    markFinished() {
      record("markFinished");
      return Promise.resolve();
    }
    markFailed() {
      record("markFailed");
      return Promise.resolve();
    }
    finishExecution() {
      record("finishExecution");
      return Promise.resolve();
    }
  },
}));

jest.mock("../../../dao/node-files/nf-workflow.dao", () => ({
  NfWorkflowDAO: class {
    getById() {
      return Promise.resolve({
        id: 3,
        requireReview: true,
        fields: [{ key: "total", label: "Total", type: "number" }],
      });
    }
  },
}));

jest.mock("../../../dao/node-files/nf-document.dao", () => ({
  NfDocumentDAO: class {
    getById() {
      return Promise.resolve({
        id: 4,
        storageKey: "nf/doc.pdf",
        contentType: "application/pdf",
        originalName: "doc.pdf",
      });
    }
  },
}));

jest.mock("../../../services/file-storage.service", () => ({
  FileStorageService: class {
    getObjectBuffer() {
      record("getObjectBuffer");
      return Promise.resolve(Buffer.from("bytes"));
    }
  },
}));

jest.mock("../../../services/node-files/executor", () => ({
  executeRun: () => {
    record("executeRun");
    return mockExecuteRun();
  },
}));

import { CountdownRemindersService } from "../../../services/countdown/countdown-reminders.service";
import {
  processNextExecution,
  processNextRun,
  sweepAbandonedExecutions,
  sweepStaleLocks,
} from "../../../services/node-files/node-files-worker";

const CLAIM: INodeFilesClaimedRun = {
  id: 11,
  uuid: "11111111-1111-4111-8111-111111111111",
  companyId: 2,
  workflowId: 3,
  documentId: 4,
};

const dueRow = (): ICountdownDueDocumentRow => ({
  id: 5,
  companyId: 2,
  title: "Póliza",
  dueDate: "2026-09-10",
  offsetDays: 3,
  reminderDays: 10,
  uploadedBy: 7,
});

const recipient = (): ICountdownReminderRecipient => ({
  id: 7,
  companyId: 2,
  email: "ana@qa-demo-co.local",
  name: "Ana",
  isActive: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(seen)) delete seen[key];
  mockClaimToday.mockResolvedValue(42);
  mockRecordOutcome.mockResolvedValue(undefined);
  mockFindDue.mockResolvedValue([dueRow()]);
  mockFindRecipients.mockResolvedValue([recipient()]);
  mockSendModuleEmail.mockResolvedValue(true);
  mockListExtracting.mockResolvedValue([]);
  mockRequeue.mockResolvedValue(0);
  mockListRunningClaims.mockResolvedValue([]);
  mockFailAbandoned.mockResolvedValue(0);
  mockClaimNext.mockResolvedValue(null);
  mockClaimNextRunnable.mockResolvedValue(null);
  mockExecuteRun.mockResolvedValue(undefined);
});

describe("countdown reminders — job audit context", () => {
  it("claims the day and records the outcome as the job, in two separate contexts", async () => {
    const outcome = await new CountdownRemindersService().runDailyOnce();

    expect(outcome).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(seen.claimToday).toEqual([JOB_REMINDERS]);
    expect(seen.recordOutcome).toEqual([JOB_REMINDERS]);
  });

  it("sends the mail OUTSIDE any armed context (R-C)", async () => {
    await new CountdownRemindersService().runDailyOnce();

    // The assertion the ruling reduces to: widening either wrapper around
    // `run()` puts the SES call inside a held transaction and flips this red.
    expect(seen.sendModuleEmail).toEqual([null]);
    // …and so is everything else run() does between the two contexts.
    expect(seen.findDue).toEqual([null]);
    expect(seen.recordDigest).toEqual([null]);
  });

  it("never sends when the day is already claimed, and records nothing", async () => {
    mockClaimToday.mockResolvedValue(undefined);

    expect(await new CountdownRemindersService().runDailyOnce()).toBeNull();
    expect(seen.sendModuleEmail).toBeUndefined();
    expect(seen.recordOutcome).toBeUndefined();
  });
});

describe("node-files worker — job audit context", () => {
  it("sweeps stale locks inside a job context", async () => {
    mockListExtracting.mockResolvedValue([{ id: 9, lockedAt: null }]);
    mockRequeue.mockResolvedValue(1);

    expect(await sweepStaleLocks(FIXTURE_COMPANY_ID)).toBe(1);
    expect(seen.listExtracting).toEqual([JOB_WORKER]);
    expect(seen.requeue).toEqual([JOB_WORKER]);
  });

  it("sweeps abandoned executions inside a job context", async () => {
    mockListRunningClaims.mockResolvedValue([{ id: 9, lockedAt: null }]);
    mockFailAbandoned.mockResolvedValue(1);

    expect(await sweepAbandonedExecutions(FIXTURE_COMPANY_ID)).toBe(1);
    expect(seen.listRunningClaims).toEqual([JOB_WORKER]);
    expect(seen.failAbandonedExecutions).toEqual([JOB_WORKER]);
  });

  it("claims a runnable run as the job but executes the graph outside it (R-C)", async () => {
    mockClaimNextRunnable.mockResolvedValue(CLAIM);

    expect(await processNextExecution(FIXTURE_COMPANY_ID)).toBe(true);
    expect(seen.claimNextRunnable).toEqual([JOB_WORKER]);
    // `executeRun` alternates node HTTP/e-mail calls with its own inserts:
    // no context may be armed around it.
    expect(seen.executeRun).toEqual([null]);
  });

  it("records a crashed execution inside its own job context", async () => {
    mockClaimNextRunnable.mockResolvedValue(CLAIM);
    mockExecuteRun.mockRejectedValue(new Error("executor exploded"));

    expect(await processNextExecution(FIXTURE_COMPANY_ID)).toBe(true);
    expect(seen.finishExecution).toEqual([JOB_WORKER]);
  });

  it("keeps the extraction path entirely outside any context (R-C)", async () => {
    mockClaimNext.mockResolvedValue(CLAIM);
    const extract = jest.fn(() => {
      record("extract");
      return Promise.resolve({ values: {}, tokensIn: 1, tokensOut: 2 });
    });

    expect(
      await processNextRun(FIXTURE_COMPANY_ID, () =>
        Promise.resolve({ extract }),
      ),
    ).toBe(true);

    // The LLM call, the byte fetch and the write that follows them: all
    // unattributed by design, none of them holding a transaction open.
    expect(seen.extract).toEqual([null]);
    expect(seen.getObjectBuffer).toEqual([null]);
    expect(seen.claimNext).toEqual([null]);
    expect(seen.markFinished).toEqual([null]);
  });
});

describe("the jobs when the audit context contributes nothing", () => {
  it("returns normal results though no wrapped step ever opened a transaction", async () => {
    // Every DAO here is a mock: `db()` is never called, so `state.trx` stays
    // empty and the commit at the end of each context is a no-op. The jobs must
    // still answer exactly what they answered before T3b.
    expect(await new CountdownRemindersService().runDailyOnce()).toEqual({
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    expect(await sweepStaleLocks(FIXTURE_COMPANY_ID)).toBe(0);
    expect(await sweepAbandonedExecutions(FIXTURE_COMPANY_ID)).toBe(0);
    expect(await processNextExecution(FIXTURE_COMPANY_ID)).toBe(false);
  });

  /**
   * Rewritten for T8 (old → new, D-95): `runDailyOnce()` used to propagate a
   * step's throw straight to the caller — there was exactly one implicit
   * tenant. db-per-company (model D-22, AC-47) makes that tenant explicit and
   * iterated: a company whose claim throws is logged and skipped so the rest
   * of the fleet still gets its reminders, the same isolation `run()` already
   * gives the batch itself. The stronger claim this keeps is unchanged in
   * spirit — the step's OWN message reaches the log, not some generic
   * transaction-wrapper text — and adds that no other tenant's day is lost
   * over it (here, trivially: the only fixture tenant IS the one that threw).
   */
  it("logs the step's own error per tenant, not a transaction error, and does not escape", async () => {
    const boom = new Error("claim failed");
    mockClaimToday.mockRejectedValue(boom);
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      new CountdownRemindersService().runDailyOnce(),
    ).resolves.toBeNull();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`tenant ${FIXTURE_COMPANY_ID}`),
      "claim failed",
    );
  });
});
