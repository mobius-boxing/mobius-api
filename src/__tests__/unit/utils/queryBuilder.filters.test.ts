/**
 * `applyFilters` — the qualification a `table:` filter adds (AC-1, I-2) plus
 * the operator/transform/unknown-key behaviors every DAO's `*_FILTERS` config
 * relies on. `parseQueryParams`'s company-scoping is covered separately in
 * `queryBuilder.company-scope.test.ts`.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { applyFilters } from "../../../utils/queryBuilder";
import { createMockQueryBuilder } from "../../mocks/knex.mock";
import type { FilterConfigs } from "../../../types/queryBuilder.types";

describe("applyFilters", () => {
  it("qualifies a plain filter with the DAO's own table", () => {
    const query = createMockQueryBuilder();
    const config: FilterConfigs = { code: { column: "code", operator: "=" } };

    applyFilters(query as any, { code: "ABC" }, config, "products");

    expect(query.where).toHaveBeenCalledWith("products.code", "=", "ABC");
  });

  it("qualifies a `table:` filter with the joined table instead of the DAO's own", () => {
    const query = createMockQueryBuilder();
    const config: FilterConfigs = {
      categoryUuid: {
        table: "customer_categories",
        column: "uuid",
        operator: "=",
      },
    };

    applyFilters(query as any, { categoryUuid: "cat-1" }, config, "customers");

    expect(query.where).toHaveBeenCalledWith(
      "customer_categories.uuid",
      "=",
      "cat-1",
    );
  });

  it("wraps an ILIKE value with wildcards", () => {
    const query = createMockQueryBuilder();
    const config: FilterConfigs = {
      code: { column: "code", operator: "ILIKE" },
    };

    applyFilters(query as any, { code: "abc" }, config, "products");

    expect(query.where).toHaveBeenCalledWith("products.code", "ILIKE", "%abc%");
  });

  it("splits an IN operator's comma-separated value into whereIn", () => {
    const query = createMockQueryBuilder();
    const config: FilterConfigs = {
      status: { column: "status", operator: "IN" },
    };

    applyFilters(query as any, { status: "pending, approved" }, config, "orders");

    expect(query.whereIn).toHaveBeenCalledWith("orders.status", [
      "pending",
      "approved",
    ]);
  });

  it("runs the configured transform before binding the value", () => {
    const query = createMockQueryBuilder();
    const transform = jest.fn((value: string) => value === "true");
    const config: FilterConfigs = {
      active: { column: "active", operator: "=", transform },
    };

    applyFilters(query as any, { active: "true" }, config, "customers");

    expect(transform).toHaveBeenCalledWith("true");
    expect(query.where).toHaveBeenCalledWith("customers.active", "=", true);
  });

  it("drops an unknown filter key silently, applying no predicate", () => {
    const query = createMockQueryBuilder();
    const config: FilterConfigs = { code: { column: "code", operator: "=" } };

    applyFilters(query as any, { totallyUnknown: "x" }, config, "products");

    expect(query.where).not.toHaveBeenCalled();
    expect(query.whereIn).not.toHaveBeenCalled();
  });

  it("drops a filter whose transform returns undefined, applying no predicate", () => {
    const query = createMockQueryBuilder();
    const config: FilterConfigs = {
      revisionFrom: {
        column: "revision",
        operator: ">=",
        transform: (value: unknown) => {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? undefined : parsed;
        },
      },
    };

    applyFilters(query as any, { revisionFrom: "not-a-number" }, config, "products");

    expect(query.where).not.toHaveBeenCalled();
  });
});
