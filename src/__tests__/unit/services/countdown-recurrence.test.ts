/**
 * Recurrence stepping for the countdown module.
 *
 * The clamping cases are the reason this function exists instead of plain Date
 * arithmetic: `new Date(2026, 0, 31 + 1 month)` overflows into March and would
 * silently walk a monthly invoice's due date forward a few days every year.
 */
import { describe, it, expect } from "@jest/globals";
import {
  nextDueDate,
  describeRecurrence,
} from "../../../services/countdown/countdown-recurrence";

describe("countdown recurrence — nextDueDate", () => {
  it("steps by whole days without touching the calendar month logic", () => {
    expect(nextDueDate("2026-08-12", 1, "day")).toBe("2026-08-13");
    expect(nextDueDate("2026-08-12", 30, "day")).toBe("2026-09-11");
  });

  it("clamps a month step to the last day of a shorter target month", () => {
    expect(nextDueDate("2026-01-31", 1, "month")).toBe("2026-02-28");
    expect(nextDueDate("2026-03-31", 1, "month")).toBe("2026-04-30");
    expect(nextDueDate("2026-01-30", 1, "month")).toBe("2026-02-28");
  });

  it("clamps into a leap February rather than overflowing", () => {
    expect(nextDueDate("2028-01-31", 1, "month")).toBe("2028-02-29");
  });

  it("keeps the day of month when the target month is long enough", () => {
    expect(nextDueDate("2026-01-15", 1, "month")).toBe("2026-02-15");
    expect(nextDueDate("2026-08-12", 2, "month")).toBe("2026-10-12");
  });

  it("rolls a month step across the year boundary", () => {
    expect(nextDueDate("2026-12-31", 1, "month")).toBe("2027-01-31");
    expect(nextDueDate("2026-11-30", 3, "month")).toBe("2027-02-28");
  });

  it("steps by years, clamping 29 February onto a common year", () => {
    expect(nextDueDate("2026-08-12", 1, "year")).toBe("2027-08-12");
    expect(nextDueDate("2028-02-29", 1, "year")).toBe("2029-02-28");
  });

  it("rejects inputs that are not calendar dates or positive steps", () => {
    expect(() => nextDueDate("12-08-2026", 1, "month")).toThrow();
    expect(() => nextDueDate("2026-08-12", 0, "month")).toThrow();
    expect(() => nextDueDate("2026-08-12", -1, "day")).toThrow();
    expect(() => nextDueDate("2026-08-12", 1.5, "day")).toThrow();
  });
});

describe("countdown recurrence — describeRecurrence", () => {
  it("reads naturally in Spanish for single and plural steps", () => {
    expect(describeRecurrence(1, "month")).toBe("cada mes");
    expect(describeRecurrence(2, "month")).toBe("cada 2 meses");
    expect(describeRecurrence(1, "day")).toBe("cada día");
    expect(describeRecurrence(15, "day")).toBe("cada 15 días");
    expect(describeRecurrence(1, "year")).toBe("cada año");
    expect(describeRecurrence(3, "year")).toBe("cada 3 años");
  });
});
