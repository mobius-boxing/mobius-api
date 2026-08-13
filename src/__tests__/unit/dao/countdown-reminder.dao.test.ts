/**
 * `CountdownReminderDAO.findDue` — the selection rule, asserted on the SQL it
 * actually emits.
 *
 * This query is the only place the reminder window exists in the database, and
 * it runs without a request: no middleware upstream, no controller test to catch
 * it. What is checked here is precisely what silently broke before — an exact
 * offset list that skipped a weekend and went quiet on anything overdue — plus
 * the enablement gate that stops mail to a company that cancelled.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

interface RawCall {
  sql: string;
  bindings: unknown[];
}

const mockRawCalls: RawCall[] = [];

jest.mock("../../../database/KnexConnection", () => ({
  __esModule: true,
  default: {
    getConnection: () => ({
      raw: (sql: string, bindings: unknown[]) => {
        mockRawCalls.push({ sql, bindings });
        return Promise.resolve({ rows: [] });
      },
    }),
  },
}));

import { CountdownReminderDAO } from "../../../dao/countdown/countdown-reminder.dao";

describe("CountdownReminderDAO.findDue", () => {
  let sql: string;
  let bindings: unknown[];

  beforeEach(async () => {
    mockRawCalls.length = 0;
    await new CountdownReminderDAO().findDue("2026-08-13");
    const call = mockRawCalls[0];
    if (!call) throw new Error("findDue emitted no query");
    sql = call.sql;
    bindings = call.bindings;
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
