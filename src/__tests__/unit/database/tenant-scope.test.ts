import { describe, it, expect } from "@jest/globals";
import { tablesOf } from "../../../database/ownership";
import {
  TENANT_SCOPE,
  tenantScopeWhere,
  describeTenantScope,
  topologicalOrder,
  type ForeignKeyEdge,
} from "../../../database/tenant-scope";

/**
 * AC-66: `TENANT_SCOPE` keys equal `tablesOf("tenant")`, and every table's
 * predicate ends in a `companyId`/`company_id` comparison.
 */
describe("TENANT_SCOPE (AC-66)", () => {
  it("has exactly one entry per tenant table, no more, no less", () => {
    expect(Object.keys(TENANT_SCOPE).sort()).toStrictEqual(
      [...tablesOf("tenant")].sort(),
    );
  });

  it("every non-empty table's generated predicate names a companyId/company_id column", () => {
    for (const table of Object.keys(TENANT_SCOPE)) {
      const entry = TENANT_SCOPE[table];
      if (entry?.kind === "empty") continue;
      const { bindings } = tenantScopeWhere(table, 1);
      expect(
        bindings.some((b) => b === "companyId" || b === "company_id"),
      ).toBe(true);
    }
  });

  it("the one 'empty' table is documented and copies nothing", () => {
    const empties = Object.entries(TENANT_SCOPE).filter(
      ([, entry]) => entry.kind === "empty",
    );
    expect(empties).toHaveLength(1);
    expect(empties[0]?.[0]).toBe("countdown_reminder_runs");
    expect(tenantScopeWhere("countdown_reminder_runs", 1).sql).toBe("false");
  });

  it("throws for a table with no entry", () => {
    expect(() => tenantScopeWhere("no_such_table", 1)).toThrow(
      /not in TENANT_SCOPE/,
    );
  });

  describe("tenantScopeWhere shapes", () => {
    it("direct", () => {
      const { sql, bindings } = tenantScopeWhere("customers", 7);
      expect(sql).toBe("t.?? = ?");
      expect(bindings).toStrictEqual(["companyId", 7]);
    });

    it("warehouse", () => {
      const { sql, bindings } = tenantScopeWhere("consumable_stock", 7);
      expect(sql).toContain("exists");
      expect(bindings).toStrictEqual([
        "warehouses",
        "warehouseId",
        "company_id",
        7,
      ]);
    });

    it("parent (single hop)", () => {
      const { sql, bindings } = tenantScopeWhere("corrugation_layers", 7);
      expect(sql).toContain("exists");
      expect(bindings).toStrictEqual([
        "corrugations",
        "corrugationId",
        "companyId",
        7,
      ]);
    });

    it("parent (two hops, grand)", () => {
      const { bindings } = tenantScopeWhere(
        "production_route_stage_machines",
        7,
      );
      expect(bindings).toStrictEqual([
        "production_route_stages",
        "production_routes",
        "routeId",
        "stageId",
        "companyId",
        7,
      ]);
    });

    it("files excludes the company's own logo", () => {
      const { sql, bindings } = tenantScopeWhere("files", 7);
      expect(sql).toContain("not exists");
      expect(bindings).toStrictEqual([
        "companyId",
        7,
        "companies",
        "logoFileUuid",
      ]);
    });
  });

  it("describeTenantScope never throws for a real table", () => {
    for (const table of Object.keys(TENANT_SCOPE)) {
      expect(() => describeTenantScope(table)).not.toThrow();
      expect(describeTenantScope(table).length).toBeGreaterThan(0);
    }
  });
});

describe("topologicalOrder", () => {
  it("orders parents before children", () => {
    const edges: ForeignKeyEdge[] = [
      { child: "b", parent: "a" },
      { child: "c", parent: "b" },
    ];
    const order = topologicalOrder(["c", "b", "a"], edges);
    expect(order).toStrictEqual(["a", "b", "c"]);
  });

  it("is deterministic (alphabetical) among ties", () => {
    const order = topologicalOrder(["z", "a", "m"], []);
    expect(order).toStrictEqual(["a", "m", "z"]);
  });

  it("ignores edges outside the requested table set", () => {
    const edges: ForeignKeyEdge[] = [{ child: "b", parent: "outside" }];
    expect(topologicalOrder(["b"], edges)).toStrictEqual(["b"]);
  });

  it("throws on a cycle", () => {
    const edges: ForeignKeyEdge[] = [
      { child: "a", parent: "b" },
      { child: "b", parent: "a" },
    ];
    expect(() => topologicalOrder(["a", "b"], edges)).toThrow(/cycle/);
  });
});
