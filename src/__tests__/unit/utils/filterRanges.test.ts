/**
 * `dayRangeFilters`/`numberRangeFilters`/`booleanFilter` — the `FilterConfig`
 * shapes `column-filters/model.md` standardizes for range and boolean
 * columns. The boundary cases here are the ones a naive `<=` on the raw
 * timestamp gets wrong: a row at 23:59:59.999999 the same day as `To`, and one
 * at midnight the day after (C-2).
 */
import { describe, it, expect } from "@jest/globals";
import {
  dayRangeFilters,
  numberRangeFilters,
  booleanFilter,
} from "../../../utils/filterRanges";

describe("dayRangeFilters", () => {
  describe("timestamp columns", () => {
    const filters = dayRangeFilters("createdAt", "createdAt", {
      timestamp: true,
    });

    it("resolves From to the start of the Buenos Aires day, in UTC", () => {
      const config = filters.createdAtFrom;
      expect(config.operator).toBe(">=");
      expect(config.transform!("2026-03-10")).toEqual(
        new Date("2026-03-10T03:00:00.000Z"),
      );
    });

    it("resolves To to the start of the NEXT Buenos Aires day, compared with <", () => {
      const config = filters.createdAtTo;
      expect(config.operator).toBe("<");
      expect(config.transform!("2026-03-10")).toEqual(
        new Date("2026-03-11T03:00:00.000Z"),
      );
    });

    it("includes a row at local midnight of the From day", () => {
      const from = filters.createdAtFrom.transform!("2026-03-10") as Date;
      const rowAtMidnight = new Date("2026-03-10T03:00:00.000Z"); // 00:00:00 BA
      expect(rowAtMidnight.getTime()).toBeGreaterThanOrEqual(from.getTime());
    });

    it("includes a row at 23:59:59.999999 BA of the To day (half-open, not <=)", () => {
      const to = filters.createdAtTo.transform!("2026-03-10") as Date;
      const rowAtLastInstant = new Date("2026-03-11T02:59:59.999Z"); // 23:59:59.999 BA
      expect(rowAtLastInstant.getTime()).toBeLessThan(to.getTime());
    });

    it("excludes a row at local midnight of the day AFTER the To day", () => {
      const to = filters.createdAtTo.transform!("2026-03-10") as Date;
      const rowNextDay = new Date("2026-03-11T03:00:00.000Z"); // 00:00:00 BA, day after
      expect(rowNextDay.getTime()).toBeGreaterThanOrEqual(to.getTime());
    });

    it("rolls the next-day boundary across a month", () => {
      expect(filters.createdAtTo.transform!("2026-01-31")).toEqual(
        new Date("2026-02-01T03:00:00.000Z"),
      );
    });
  });

  describe("date columns", () => {
    const filters = dayRangeFilters("deliveryDate", "deliveryDate", {
      timestamp: false,
    });

    it("binds the raw date with >= / <= and no transform", () => {
      expect(filters.deliveryDateFrom).toEqual({
        column: "deliveryDate",
        operator: ">=",
      });
      expect(filters.deliveryDateTo).toEqual({
        column: "deliveryDate",
        operator: "<=",
      });
    });
  });
});

describe("numberRangeFilters", () => {
  const filters = numberRangeFilters("revision", "revision");

  it("transforms a numeric string for both bounds", () => {
    expect(filters.revisionFrom.transform!("3")).toBe(3);
    expect(filters.revisionTo.transform!("7")).toBe(7);
    expect(filters.revisionFrom.operator).toBe(">=");
    expect(filters.revisionTo.operator).toBe("<=");
  });

  it("drops a non-numeric value by transforming it to undefined", () => {
    expect(filters.revisionFrom.transform!("not-a-number")).toBeUndefined();
  });
});

describe("booleanFilter", () => {
  it("transforms the string 'true'/'false' to a boolean", () => {
    const config = booleanFilter("vip");
    expect(config.column).toBe("vip");
    expect(config.operator).toBe("=");
    expect(config.transform!("true")).toBe(true);
    expect(config.transform!("false")).toBe(false);
  });
});
