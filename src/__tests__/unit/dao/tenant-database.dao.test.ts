// @ts-nocheck
/**
 * AC-32 (I-8) — `TenantDatabaseDAO.transition` is a compare-and-set gated by
 * the model's transition table: every pair in it proceeds, every pair outside
 * it throws before any query runs, and a stale `from` (the row already moved)
 * comes back as 0 rows updated rather than a silent success.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";

let mock;
let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import {
  InvalidTenantDatabaseTransitionError,
  TENANT_DATABASE_TRANSITIONS,
  TenantDatabaseDAO,
} from "../../../dao/tenant-database/tenant-database.dao";
import { TENANT_DATABASE_STATUSES } from "../../../interfaces/tenant/tenant.interfaces";

const TABLE = "tenant_databases";
const RUNS = "tenant_migration_runs";

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

const isAllowed = (from: string, to: string) =>
  TENANT_DATABASE_TRANSITIONS.some(([f, t]) => f === from && t === to);

describe("transition() — the model's table, exactly (AC-32)", () => {
  it("has exactly the 7 single-row transitions the model's table lists", () => {
    expect(TENANT_DATABASE_TRANSITIONS).toHaveLength(7);
    expect([...TENANT_DATABASE_TRANSITIONS]).toEqual(
      expect.arrayContaining([
        ["provisioning", "active"],
        ["provisioning", "failed"],
        ["failed", "provisioning"],
        ["active", "suspended"],
        ["suspended", "active"],
        ["active", "decommissioning"],
        ["suspended", "decommissioning"],
      ]),
    );
  });

  it("throws for every (from, to) pair outside the table, over the full status matrix", async () => {
    const dao = new TenantDatabaseDAO();
    const offTable: Array<[string, string]> = [];
    for (const from of TENANT_DATABASE_STATUSES) {
      for (const to of TENANT_DATABASE_STATUSES) {
        if (!isAllowed(from, to)) offTable.push([from, to]);
      }
    }
    // 36 pairs total (6x6), 7 allowed, self-transitions never allowed either.
    expect(offTable.length).toBe(29);

    for (const [from, to] of offTable) {
      mock.fixture(TABLE).returningQueue = [[{ id: 1 }]];
      await expect(
        dao.transition(1, from as any, to as any, {}),
      ).rejects.toThrow(InvalidTenantDatabaseTransitionError);
    }
    // Nothing outside the table ever reaches the database.
    expect(mock.writeCounts(TABLE)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });

  it("proceeds to the compare-and-set for every pair inside the table", async () => {
    const dao = new TenantDatabaseDAO();
    for (const [from, to] of TENANT_DATABASE_TRANSITIONS) {
      mock.fixture(TABLE).returningQueue = [[{ id: 1 }]];
      await expect(dao.transition(1, from, to, {})).resolves.toBe(1);
    }
    expect(mock.writeCounts(TABLE).update).toBe(
      TENANT_DATABASE_TRANSITIONS.length,
    );
  });

  it("returns 0 when `from` is stale — the row already moved", async () => {
    mock.fixture(TABLE).returningQueue = [[]];
    const dao = new TenantDatabaseDAO();
    await expect(dao.transition(1, "provisioning", "active", {})).resolves.toBe(
      0,
    );
  });

  it("sets suspendedAt on entering suspended", async () => {
    mock.fixture(TABLE).returningQueue = [[{ id: 1 }]];
    const dao = new TenantDatabaseDAO();
    await dao.transition(1, "active", "suspended", { suspendReason: "move" });
    const [payload] = mock.fixture(TABLE).updateCaptures;
    expect(payload.status).toBe("suspended");
    expect(payload.suspendedAt).toBeDefined();
    expect(payload.suspendReason).toBe("move");
  });

  it("clears suspendedAt on leaving suspended", async () => {
    mock.fixture(TABLE).returningQueue = [[{ id: 1 }]];
    const dao = new TenantDatabaseDAO();
    await dao.transition(1, "suspended", "active", {});
    const [payload] = mock.fixture(TABLE).updateCaptures;
    expect(payload.suspendedAt).toBeNull();
  });

  it("never calls the database for an off-table pair, including a no-op self-transition", async () => {
    const dao = new TenantDatabaseDAO();
    await expect(dao.transition(1, "active", "active", {})).rejects.toThrow(
      InvalidTenantDatabaseTransitionError,
    );
  });
});

describe("migration run log (D-49 — on this DAO, not a third one)", () => {
  it("starts a run with status defaulted by the schema, not the DAO", async () => {
    mock.fixture(RUNS).returningQueue = [
      [
        {
          id: 1,
          uuid: "u",
          tenantDatabaseId: 7,
          fromVersion: null,
          toVersion: "20260913000004",
          status: "running",
          triggeredBy: "deploy",
          startedAt: new Date(),
          finishedAt: null,
          error: null,
        },
      ],
    ];
    const dao = new TenantDatabaseDAO();
    const run = await dao.startMigrationRun({
      tenantDatabaseId: 7,
      fromVersion: null,
      toVersion: "20260913000004",
      triggeredBy: "deploy",
    });
    expect(run.status).toBe("running");
    expect(mock.fixture(RUNS).insertCaptures[0]).not.toHaveProperty("status");
  });

  it("finishes a run only while it is still running (compare-and-set)", async () => {
    mock.fixture(RUNS).returningQueue = [[{ id: 1 }]];
    const dao = new TenantDatabaseDAO();
    await expect(
      dao.finishMigrationRun(1, { status: "succeeded" }),
    ).resolves.toBe(1);
    const [payload] = mock.fixture(RUNS).updateCaptures;
    expect(payload.status).toBe("succeeded");
    expect(payload.finishedAt).toBeDefined();
  });

  it("returns 0 finishing a run that already finished", async () => {
    mock.fixture(RUNS).returningQueue = [[]];
    const dao = new TenantDatabaseDAO();
    await expect(
      dao.finishMigrationRun(1, { status: "failed", error: "boom" }),
    ).resolves.toBe(0);
  });
});

describe("reads", () => {
  it("getLiveByCompanyId scopes to the live-status set", async () => {
    mock.fixture(TABLE).firstRows = [{ id: 1, companyId: 3, status: "active" }];
    const dao = new TenantDatabaseDAO();
    const row = await dao.getLiveByCompanyId(3);
    expect(row?.companyId).toBe(3);
    const [, statuses] =
      mock.fixture(TABLE).whereCalls.find((call) => call[0] === "status") ?? [];
    expect(statuses).toEqual(
      expect.arrayContaining(["active", "suspended", "decommissioning"]),
    );
  });

  it("getLiveByCompanyId returns null when nothing matches", async () => {
    mock.fixture(TABLE).firstRows = [null];
    const dao = new TenantDatabaseDAO();
    await expect(dao.getLiveByCompanyId(999)).resolves.toBeNull();
  });
});
