/**
 * The node-files worker's cross-tenant round-robin and idle backoff
 * (db-per-company T8, model D-22, AC-48).
 *
 * The worker used to serve every company off one shared connection; now it
 * visits one tenant's own database at a time, inside that company's
 * `withTenant` scope, and must never hold one open while the (mocked)
 * extraction provider awaits — the exact shape a held connection on a
 * five-connection pool would starve. `rotateTenants` is pure and pinned on
 * its own; `runNodeFilesWorkerTick` is exercised against mocked DAOs, the
 * same style as `job-audit-context.test.ts`'s node-files section.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { INodeFilesLockCandidate } from "../../../dao/node-files/nf-run.dao";
import type { INodeFilesClaimedRun } from "../../../interfaces/node-files/node-files.interfaces";

const mockCompanyIdsWithModuleEnabled =
  jest.fn<(slug: string) => Promise<readonly number[]>>();

jest.mock("../../../services/core-client.service", () => ({
  CoreClient: {
    companyIdsWithModuleEnabled: (slug: string) =>
      mockCompanyIdsWithModuleEnabled(slug),
  },
}));

/**
 * Tracks how many `withTenant` scopes are open at once, so the "no
 * transaction while the provider awaits" claim (AC-48) is asserted directly
 * rather than inferred from the source.
 */
let openTenantScopes = 0;
let maxOpenDuringProviderCall = 0;

/**
 * The pass-through default. Re-applied in every `beforeEach` below:
 * `.mockImplementation()` overrides (the "a tenant's scope throws" case)
 * outlive `jest.clearAllMocks()`, which clears call history but not a
 * previously-set implementation.
 */
const defaultWithTenantImpl = async <T>(
  _companyId: number,
  fn: () => Promise<T>,
): Promise<T> => {
  openTenantScopes += 1;
  try {
    return await fn();
  } finally {
    openTenantScopes -= 1;
  }
};

const mockWithTenant = jest.fn(defaultWithTenantImpl);

jest.mock("../../../database/registry", () => ({
  withTenant: (companyId: number, fn: () => Promise<unknown>) =>
    mockWithTenant(companyId, fn),
}));

jest.mock("../../../database/audit-context", () => ({
  withAuditContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

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
const mockMarkFailed =
  jest.fn<(id: number, companyId: number, message: string) => Promise<void>>();
const mockMarkFinished = jest.fn<() => Promise<void>>();
const mockFinishExecution = jest.fn<() => Promise<void>>();

jest.mock("../../../dao/node-files/nf-run.dao", () => ({
  NfRunDAO: class {
    listExtracting() {
      return mockListExtracting();
    }
    requeue(ids: number[]) {
      return mockRequeue(ids);
    }
    listRunningClaims() {
      return mockListRunningClaims();
    }
    failAbandonedExecutions(ids: number[], message: string) {
      return mockFailAbandoned(ids, message);
    }
    claimNext(lockedBy: string) {
      return mockClaimNext(lockedBy);
    }
    claimNextRunnable(lockedBy: string) {
      return mockClaimNextRunnable(lockedBy);
    }
    markFailed(id: number, companyId: number, message: string) {
      return mockMarkFailed(id, companyId, message);
    }
    markFinished() {
      return mockMarkFinished();
    }
    finishExecution() {
      return mockFinishExecution();
    }
  },
}));

const mockWorkflowGetById = jest.fn<
  (
    id: number,
    companyId: number,
  ) => Promise<{
    id: number;
    requireReview: boolean;
    fields: unknown[];
  } | null>
>();

jest.mock("../../../dao/node-files/nf-workflow.dao", () => ({
  NfWorkflowDAO: class {
    getById(id: number, companyId: number) {
      return mockWorkflowGetById(id, companyId);
    }
  },
}));

const mockDocumentGetById = jest.fn<
  (
    id: number,
    companyId: number,
  ) => Promise<{
    storageKey: string;
    contentType: string;
    originalName: string;
  } | null>
>();

jest.mock("../../../dao/node-files/nf-document.dao", () => ({
  NfDocumentDAO: class {
    getById(id: number, companyId: number) {
      return mockDocumentGetById(id, companyId);
    }
  },
}));

jest.mock("../../../services/file-storage.service", () => ({
  FileStorageService: class {
    getObjectBuffer() {
      return Promise.resolve(Buffer.from("bytes"));
    }
  },
}));

const mockExecuteRun = jest.fn<() => Promise<void>>();
jest.mock("../../../services/node-files/executor", () => ({
  executeRun: () => mockExecuteRun(),
}));

import {
  rotateTenants,
  runNodeFilesWorkerTick,
  processNextRun,
  resetNodeFilesWorkerRoundRobinForTest,
  NF_WORKER_IDLE_BACKOFF_MS,
} from "../../../services/node-files/node-files-worker";

const CLAIM = (companyId: number): INodeFilesClaimedRun => ({
  id: companyId,
  uuid: `11111111-1111-4111-8111-${String(companyId).padStart(12, "0")}`,
  companyId,
  workflowId: companyId,
  documentId: companyId,
});

describe("rotateTenants", () => {
  it("starts right after the tenant that yielded work last time", () => {
    expect(rotateTenants([10, 20, 30], 10)).toEqual([20, 30, 10]);
    expect(rotateTenants([10, 20, 30], 20)).toEqual([30, 10, 20]);
    expect(rotateTenants([10, 20, 30], 30)).toEqual([10, 20, 30]);
  });

  it("starts from the top when nothing has yielded yet", () => {
    expect(rotateTenants([10, 20, 30], null)).toEqual([10, 20, 30]);
  });

  it("starts from the top when the last yielder is no longer active", () => {
    // Module disabled, or no longer active — the round must not throw or
    // skip a tick over a company that simply left the list.
    expect(rotateTenants([10, 20, 30], 999)).toEqual([10, 20, 30]);
  });

  it("is a no-op on an empty list", () => {
    expect(rotateTenants([], 10)).toEqual([]);
  });

  it("wraps a single-tenant list onto itself", () => {
    expect(rotateTenants([10], 10)).toEqual([10]);
  });
});

describe("runNodeFilesWorkerTick — cross-tenant round-robin (AC-48)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithTenant.mockImplementation(defaultWithTenantImpl);
    resetNodeFilesWorkerRoundRobinForTest();
    openTenantScopes = 0;
    maxOpenDuringProviderCall = 0;
    mockListExtracting.mockResolvedValue([]);
    mockListRunningClaims.mockResolvedValue([]);
    mockClaimNextRunnable.mockResolvedValue(null);
    mockClaimNext.mockResolvedValue(null);
  });

  it("returns false and asks nothing of any DAO when no tenant has the module enabled", async () => {
    mockCompanyIdsWithModuleEnabled.mockResolvedValue([]);

    expect(await runNodeFilesWorkerTick()).toBe(false);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("visits tenants round-robin and remembers the one that yielded, for next time", async () => {
    mockCompanyIdsWithModuleEnabled.mockResolvedValue([1, 2, 3]);
    // Only tenant 2 has a queued run; tenants 1 and 3 find nothing anywhere.
    mockClaimNext.mockImplementation((_lockedBy: string) =>
      Promise.resolve(null),
    );
    mockClaimNext.mockResolvedValueOnce(null); // tenant 1: nothing
    mockClaimNext.mockResolvedValueOnce(CLAIM(2)); // tenant 2: a run
    mockWorkflowGetById.mockResolvedValue(null); // "El flujo ya no existe" — short-circuits before the provider

    const found = await runNodeFilesWorkerTick();

    expect(found).toBe(true);
    // Visited in list order, stopping at the first that did anything: tenant
    // 3 is never reached this tick.
    const visitedOrder = [
      ...new Set(mockWithTenant.mock.calls.map((call) => call[0])),
    ];
    expect(visitedOrder).toEqual([1, 2]);
    expect(mockMarkFailed).toHaveBeenCalledWith(
      2,
      2,
      expect.stringContaining("El flujo ya no existe"),
    );

    // The next round starts AFTER tenant 2 — not from the top.
    mockCompanyIdsWithModuleEnabled.mockResolvedValue([1, 2, 3]);
    mockClaimNext.mockReset();
    mockClaimNext.mockResolvedValue(null);
    mockWithTenant.mockClear();

    expect(await runNodeFilesWorkerTick()).toBe(false);
    const secondRoundOrder = [
      ...new Set(mockWithTenant.mock.calls.map((call) => call[0])),
    ];
    expect(secondRoundOrder).toEqual([3, 1, 2]);
  });

  it("logs and skips a tenant whose scope throws (suspended/unavailable), and still checks the rest", async () => {
    mockCompanyIdsWithModuleEnabled.mockResolvedValue([1, 2]);
    mockWithTenant.mockImplementation(
      async <T>(companyId: number, fn: () => Promise<T>): Promise<T | null> => {
        if (companyId === 1) throw new Error("tenant suspended");
        return fn();
      },
    );
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const found = await runNodeFilesWorkerTick();

    expect(found).toBe(false); // tenant 2 also found nothing, but didn't throw
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("tenant 1"),
      "tenant suspended",
    );
  });

  it("sweeps stale locks and abandoned executions per tenant before claiming", async () => {
    mockCompanyIdsWithModuleEnabled.mockResolvedValue([1]);
    mockListExtracting.mockResolvedValue([{ id: 9, lockedAt: null }]);
    mockRequeue.mockResolvedValue(1);

    await runNodeFilesWorkerTick();

    expect(mockListExtracting).toHaveBeenCalledTimes(1);
    expect(mockRequeue).toHaveBeenCalledWith([9]);
  });
});

describe("processNextRun — no tenant scope open while the provider awaits (AC-48)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithTenant.mockImplementation(defaultWithTenantImpl);
    openTenantScopes = 0;
    maxOpenDuringProviderCall = 0;
  });

  it("claims and completes inside short withTenant scopes, with none open during extraction", async () => {
    const claim = CLAIM(5);
    mockClaimNext.mockResolvedValue(claim);
    mockWorkflowGetById.mockResolvedValue({
      id: 5,
      requireReview: true,
      fields: [{ key: "total", label: "Total", type: "number" }],
    });
    mockDocumentGetById.mockResolvedValue({
      storageKey: "nf/doc.pdf",
      contentType: "application/pdf",
      originalName: "doc.pdf",
    });

    const extract = jest.fn(async () => {
      // The load-bearing assertion: whatever `withTenant` scopes were open
      // when the provider was invoked, none may still be open.
      maxOpenDuringProviderCall = Math.max(
        maxOpenDuringProviderCall,
        openTenantScopes,
      );
      return { values: {}, tokensIn: 1, tokensOut: 2 };
    });
    const providerFactory = () => Promise.resolve({ extract });

    const found = await processNextRun(5, providerFactory);

    expect(found).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(openTenantScopes).toBe(0);
    // The mock records the scope depth exactly at the moment `extract` ran —
    // zero, not "eventually back to zero after the fact".
    expect(maxOpenDuringProviderCall).toBe(0);
    expect(mockMarkFinished).toHaveBeenCalledTimes(1);
  });
});

describe("NF_WORKER_IDLE_BACKOFF_MS", () => {
  it("is the model's 5 → 10 → … → 60 s ladder", () => {
    expect(NF_WORKER_IDLE_BACKOFF_MS).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000,
    ]);
  });
});
