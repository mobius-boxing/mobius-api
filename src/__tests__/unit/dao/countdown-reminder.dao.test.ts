/**
 * `CountdownReminderDAO` — the selection rule and the recipient lookup, each
 * asserted on what it actually sends and on which connection it sends it.
 *
 * `findDue` is the only place the reminder window exists in the database, and it
 * runs without a request: no middleware upstream, no controller test to catch
 * it. What is checked there is precisely what silently broke before — an exact
 * offset list that skipped a weekend and went quiet on anything overdue — plus
 * the enablement gate that stops mail to a company that cancelled.
 *
 * `findRecipients` is checked for the database it reads. `users` belongs to
 * core; asking countdown for it throws under the registry's guard, and because
 * `runDailyOnce` claims the day in `countdown_reminder_runs` *before* running
 * the batch, a throw there loses that day's reminders with no retry — one
 * swallowed `console.error` and every later tick returns null.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

interface RawCall {
  sql: string;
  bindings: unknown[];
}

interface TableCall {
  table: string;
  whereIn?: [string, unknown[]];
  select?: string[];
}

/**
 * Captured per database key. The registry mock routes by key and each key
 * answers with a different row set, so a query issued on the wrong connection
 * shows up twice over: in the wrong bucket, and as a row that cannot exist
 * (AC-7 — `core` and `countdown` stubs must not bleed into one another).
 */
const mockRawCalls: Record<string, RawCall[]> = {
  core: [],
  tenant: [],
};
const mockTableCalls: Record<string, TableCall[]> = {
  core: [],
  tenant: [],
};
const mockRows: Record<string, unknown[]> = {
  core: [],
  tenant: [],
};

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: (key: string) => {
    // Callable like the real connection, so a builder query is routed by key
    // too — not only `raw`.
    const connection = (table: string) => {
      const call: TableCall = { table };
      mockTableCalls[key].push(call);
      const builder = {
        whereIn: (column: string, values: unknown[]) => {
          call.whereIn = [column, values];
          return builder;
        },
        select: (...columns: string[]) => {
          call.select = columns;
          return Promise.resolve(mockRows[key]);
        },
      };
      return builder;
    };
    connection.raw = (sql: string, bindings: unknown[]) => {
      mockRawCalls[key].push({ sql, bindings });
      return Promise.resolve({
        rows: key === "tenant" ? [] : [{ answeredBy: key }],
      });
    };
    return connection;
  },
}));

/**
 * The core side of both reads is `CoreClient` (its own queries and predicates
 * are pinned in core-client.service.test.ts); here it is a recorder, so what
 * this DAO asks of core is asserted exactly.
 */
const mockCoreCalls: Array<{ method: string; args: unknown[] }> = [];
let mockEnabledCompanyIds: number[] = [];
let mockCoreUsers: unknown[] = [];
let mockCompanyUserIds = new Map<number, number[]>();

jest.mock("../../../services/core-client.service", () => ({
  ...jest.requireActual<object>("../../../services/core-client.service"),
  __esModule: true,
  CoreClient: {
    companyIdsWithModuleEnabled: async (...args: unknown[]) => {
      mockCoreCalls.push({ method: "companyIdsWithModuleEnabled", args });
      return mockEnabledCompanyIds;
    },
    usersByIds: async (...args: unknown[]) => {
      mockCoreCalls.push({ method: "usersByIds", args });
      return mockCoreUsers;
    },
    activeUserIdsByCompanies: async (...args: unknown[]) => {
      mockCoreCalls.push({ method: "activeUserIdsByCompanies", args });
      return mockCompanyUserIds;
    },
  },
}));

const resetCaptures = (): void => {
  for (const key of Object.keys(mockRawCalls)) {
    mockRawCalls[key].length = 0;
    mockTableCalls[key].length = 0;
    mockRows[key] = [];
  }
  mockCoreCalls.length = 0;
  mockEnabledCompanyIds = [];
  mockCoreUsers = [];
  mockCompanyUserIds = new Map();
};

import { CountdownReminderDAO } from "../../../dao/countdown/countdown-reminder.dao";

describe("CountdownReminderDAO.findDue", () => {
  let sql: string;
  let bindings: unknown[];

  beforeEach(async () => {
    resetCaptures();
    mockEnabledCompanyIds = [3, 6];
    await new CountdownReminderDAO().findDue("2026-08-13");
    const call = mockRawCalls.tenant[0];
    if (!call) throw new Error("findDue emitted no query on the tenant key");
    sql = call.sql;
    bindings = call.bindings;
  });

  it("runs on the tenant connection and on no other", () => {
    expect(mockRawCalls.tenant).toHaveLength(1);
    expect(mockRawCalls.core).toEqual([]);
  });

  it("selects on the document's own threshold, with no lower bound", () => {
    expect(sql).toContain(`(d."dueDate" - ?::date) <= d."reminderDays"`);
    // The offset list is gone: a fixed 7/3/1/0 escalation dropped any document
    // whose offset day landed on a weekend and never mentioned an overdue one.
    expect(sql).not.toMatch(/\?::date\)\s*in \(/);
  });

  it("binds the caller's today exactly twice — never `current_date`", () => {
    // The session is UTC; the customer's day comes from todayInBuenosAires, and
    // one definition of today serves the claim and the work. Between the two
    // sits the enabled-company list from core.
    expect(bindings).toEqual(["2026-08-13", [3, 6], "2026-08-13"]);
    expect(sql).not.toContain("current_date");
  });

  it("returns the threshold as well as comparing it", () => {
    // The service re-applies isInReminderWindow to each row, so the rule stays
    // testable without a database.
    expect(sql).toContain(`d."reminderDays"`);
    expect(sql).toContain(`(d."dueDate" - ?::date) as "offsetDays"`);
  });

  it("never selects a resolved document", () => {
    expect(sql).toContain(`d.status = 'pending'`);
  });

  it("keeps the module-enablement and subscription gate", () => {
    // The gate itself (enabled link, not canceled/past_due, slug) is
    // CoreClient.companyIdsWithModuleEnabled's predicate; here: it is asked for
    // countdown, once, and its answer is the only company filter.
    expect(mockCoreCalls).toEqual([
      { method: "companyIdsWithModuleEnabled", args: ["countdown"] },
    ]);
    expect(sql).toContain(`d."companyId" = any(?)`);
    expect(bindings[1]).toEqual(mockEnabledCompanyIds);
  });

  it("orders deterministically, so a digest and its log rows are reproducible", () => {
    expect(sql).toContain(`order by d."dueDate" asc, d.title asc, d.id asc`);
  });
});

describe("CountdownReminderDAO.findDue — no company has the module", () => {
  beforeEach(() => {
    resetCaptures();
  });

  it("selects nothing and sends no query at all", async () => {
    mockEnabledCompanyIds = [];

    await expect(
      new CountdownReminderDAO().findDue("2026-08-13"),
    ).resolves.toEqual([]);
    for (const calls of Object.values(mockRawCalls)) expect(calls).toEqual([]);
  });
});

describe("CountdownReminderDAO.findRecipients", () => {
  beforeEach(() => {
    resetCaptures();
  });

  it("reads `users` on the core connection and on no other", async () => {
    mockCoreUsers = [
      {
        id: 7,
        uuid: "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60",
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        isActive: true,
        companyId: 3,
        role: "member",
      },
    ];
    // The row a countdown-keyed lookup would have returned; any table read on
    // any connection is the tell.
    mockRows.tenant = [
      {
        id: 99,
        email: "wrong-database@example.com",
        firstName: "Wrong",
        lastName: "Database",
        isActive: true,
        companyId: 99,
      },
    ];

    const recipients = await new CountdownReminderDAO().findRecipients([7]);

    expect(mockCoreCalls).toEqual([{ method: "usersByIds", args: [[7]] }]);
    for (const calls of Object.values(mockTableCalls))
      expect(calls).toEqual([]);
    expect(recipients).toEqual([
      {
        id: 7,
        email: "ada@example.com",
        name: "Ada Lovelace",
        isActive: true,
        companyId: 3,
      },
    ]);
  });

  it("batches the whole id list into one query", async () => {
    await new CountdownReminderDAO().findRecipients([7, 8, 9]);

    expect(mockCoreCalls).toEqual([
      { method: "usersByIds", args: [[7, 8, 9]] },
    ]);
  });

  it("never returns a user with no company — no document can pair with one", async () => {
    mockCoreUsers = [
      {
        id: 1,
        uuid: "9c8b7a65-4321-4f0e-9d1c-2b3a4c5d6e7f",
        email: "root@example.com",
        firstName: "Root",
        lastName: "",
        isActive: true,
        companyId: null,
        role: "superAdmin",
      },
    ];

    await expect(
      new CountdownReminderDAO().findRecipients([1]),
    ).resolves.toEqual([]);
  });

  it("touches no connection at all for an empty id list", async () => {
    const recipients = await new CountdownReminderDAO().findRecipients([]);

    expect(recipients).toEqual([]);
    expect(mockCoreCalls).toEqual([]);
    for (const calls of Object.values(mockTableCalls))
      expect(calls).toEqual([]);
  });
});

describe("CountdownReminderDAO.findCompanyRecipientIds", () => {
  beforeEach(() => {
    resetCaptures();
  });

  it("asks core once for every company, and hands back a map it can own", async () => {
    mockCompanyUserIds = new Map([[3, [7, 8]]]);

    const byCompany = await new CountdownReminderDAO().findCompanyRecipientIds([
      3, 6,
    ]);

    expect(mockCoreCalls).toEqual([
      { method: "activeUserIdsByCompanies", args: [[3, 6]] },
    ]);
    expect(byCompany).toEqual(new Map([[3, [7, 8]]]));
    expect(byCompany.get(3)).not.toBe(mockCompanyUserIds.get(3));
    for (const calls of Object.values(mockTableCalls))
      expect(calls).toEqual([]);
  });
});
