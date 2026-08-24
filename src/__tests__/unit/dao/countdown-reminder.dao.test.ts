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
  erp: [],
  countdown: [],
  store: [],
};
const mockTableCalls: Record<string, TableCall[]> = {
  core: [],
  erp: [],
  countdown: [],
  store: [],
};
const mockRows: Record<string, unknown[]> = {
  core: [],
  erp: [],
  countdown: [],
  store: [],
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
        rows: key === "countdown" ? [] : [{ answeredBy: key }],
      });
    };
    return connection;
  },
}));

const resetCaptures = (): void => {
  for (const key of Object.keys(mockRawCalls)) {
    mockRawCalls[key].length = 0;
    mockTableCalls[key].length = 0;
    mockRows[key] = [];
  }
};

import { CountdownReminderDAO } from "../../../dao/countdown/countdown-reminder.dao";

describe("CountdownReminderDAO.findDue", () => {
  let sql: string;
  let bindings: unknown[];

  beforeEach(async () => {
    resetCaptures();
    await new CountdownReminderDAO().findDue("2026-08-13");
    const call = mockRawCalls.countdown[0];
    if (!call) throw new Error("findDue emitted no query on the countdown key");
    sql = call.sql;
    bindings = call.bindings;
  });

  it("runs on the countdown connection and on no other", () => {
    expect(mockRawCalls.countdown).toHaveLength(1);
    expect(mockRawCalls.core).toEqual([]);
    expect(mockRawCalls.erp).toEqual([]);
    expect(mockRawCalls.store).toEqual([]);
  });

  it("selects on the document's own threshold, with no lower bound", () => {
    expect(sql).toContain(`(d."dueDate" - ?::date) <= d."reminderDays"`);
    // The offset list is gone: a fixed 7/3/1/0 escalation dropped any document
    // whose offset day landed on a weekend and never mentioned an overdue one.
    // (The one surviving `in (` is the subscription-status gate, below.)
    expect(sql).not.toMatch(/\?::date\)\s*in \(/);
  });

  it("binds the caller's today exactly twice — never `current_date`", () => {
    // The session is UTC; the customer's day comes from todayInBuenosAires, and
    // one definition of today serves the claim and the work.
    expect(bindings).toEqual(["2026-08-13", "2026-08-13"]);
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
    expect(sql).toContain(`cm.enabled = true`);
    expect(sql).toContain(
      `cm."subscriptionStatus" not in ('canceled','past_due')`,
    );
    expect(sql).toContain(`m.slug = 'countdown'`);
  });

  it("orders deterministically, so a digest and its log rows are reproducible", () => {
    expect(sql).toContain(`order by d."dueDate" asc, d.title asc, d.id asc`);
  });
});

describe("CountdownReminderDAO.findRecipients", () => {
  beforeEach(() => {
    resetCaptures();
  });

  it("reads `users` on the core connection and on no other", async () => {
    mockRows.core = [
      {
        id: 7,
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        isActive: true,
        companyId: 3,
      },
    ];
    // The row a countdown-keyed lookup would have returned. Under the real
    // registry that call throws instead; here the wrong row is the tell.
    mockRows.countdown = [
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

    expect(mockTableCalls.core.map((call) => call.table)).toEqual(["users"]);
    expect(mockTableCalls.countdown).toEqual([]);
    expect(mockTableCalls.erp).toEqual([]);
    expect(mockTableCalls.store).toEqual([]);
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

    expect(mockTableCalls.core).toHaveLength(1);
    expect(mockTableCalls.core[0]?.whereIn).toEqual(["id", [7, 8, 9]]);
    expect(mockTableCalls.core[0]?.select).toEqual([
      "id",
      "email",
      "firstName",
      "lastName",
      "isActive",
      "companyId",
    ]);
  });

  it("touches no connection at all for an empty id list", async () => {
    const recipients = await new CountdownReminderDAO().findRecipients([]);

    expect(recipients).toEqual([]);
    for (const calls of Object.values(mockTableCalls))
      expect(calls).toEqual([]);
  });
});
