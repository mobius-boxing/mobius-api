/**
 * `FilterConfig` factories for the query-param shapes `column-filters/model.md`
 * standardizes across DAOs: a `${param}From`/`${param}To` pair for dates and
 * numbers, and a single boolean column. Each DAO wires these under its own
 * `${param}From`/`${param}To`/`<param>` keys in its `*_FILTERS` config.
 */
import type { FilterConfig, FilterConfigs } from "../types/queryBuilder.types";
import { startOfBuenosAiresDayUtc } from "./buenosAiresDay";

/**
 * `column-filters/model.md`'s day-range convention: bare `'YYYY-MM-DD'` query
 * values, half-open on the calendar day.
 *
 * `timestamp: true` (the column stores a moment, e.g. `createdAt`) resolves
 * both bounds against Buenos Aires day boundaries — `To` is the START OF THE
 * NEXT day compared with `<`, not that day's 23:59:59, so a row timestamped at
 * the last instant of the day is still included (C-2).
 *
 * `timestamp: false` (the column stores a bare date, e.g. `deliveryDate`) has
 * no timezone to resolve: the raw `'YYYY-MM-DD'` binds directly, `To` compared
 * with `<=`.
 */
export function dayRangeFilters(
  param: string,
  column: string,
  { timestamp }: { timestamp: boolean },
): FilterConfigs {
  if (timestamp) {
    return {
      [`${param}From`]: {
        column,
        operator: ">=",
        transform: (value: string) => startOfBuenosAiresDayUtc(value),
      },
      [`${param}To`]: {
        column,
        operator: "<",
        transform: (value: string) => startOfBuenosAiresDayUtc(value, 1),
      },
    };
  }

  return {
    [`${param}From`]: { column, operator: ">=" },
    [`${param}To`]: { column, operator: "<=" },
  };
}

/**
 * `>=`/`<=` bounds with a `Number` transform. A non-numeric raw value (a
 * malformed query param, not merely absent) transforms to `undefined`, which
 * `applyFilters` treats as "drop this filter" — the same silent-drop the
 * builder already applies to an unknown key, rather than binding `NaN` to
 * Postgres.
 */
export function numberRangeFilters(
  param: string,
  column: string,
): FilterConfigs {
  const transform = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return {
    [`${param}From`]: { column, operator: ">=", transform },
    [`${param}To`]: { column, operator: "<=", transform },
  };
}

/** `?<param>=true|false` → `column = true|false`. */
export function booleanFilter(column: string): FilterConfig {
  return {
    column,
    operator: "=",
    transform: (value: string) => value === "true",
  };
}
