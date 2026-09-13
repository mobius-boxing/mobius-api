/**
 * The emitted SQL of the id-based scope helpers (AC-7), and which scope a
 * request gets (T1/D-97, T1/D-98). SQL is asserted on real knex output rather
 * than on mocked builder calls: "no join" and "matches nothing" are properties
 * of the statement, and a mock would record whatever the helper happened to call.
 */
import { describe, it, expect, afterAll } from "@jest/globals";
import type { Request } from "express";
import knexFactory from "knex";
import {
  applyCompanyScope,
  applyCompanyScopeViaWarehouse,
  companyFilterScope,
  UNRESOLVED_COMPANY,
} from "../../../utils/daoScope";

// No connection: `toSQL()` compiles without ever opening one.
const knex = knexFactory({ client: "pg" });

afterAll(async () => {
  await knex.destroy();
});

const COMPANY_A = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const COMPANY_B = "9c8b7a65-4321-4f0e-9d1c-2b3a4c5d6e7f";

type Role = "member" | "admin" | "superAdmin";

/** A request as `authenticate` leaves it: `companyId` is what it resolved. */
const requestAs = (
  role: Role,
  options: {
    tokenCompany?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    companyId?: number;
  } = {},
): Request =>
  ({
    user: {
      userId: "6f0a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      email: "someone@acme.test",
      role,
      companyId: options.tokenCompany,
    },
    query: options.query ?? {},
    body: options.body ?? {},
    companyId: options.companyId,
  }) as unknown as Request;

describe("applyCompanyScope", () => {
  it("adds a local predicate on the table's company column, with no join", () => {
    const { sql, bindings } = applyCompanyScope(
      knex("customers").select("customers.*"),
      "customers",
      7,
    ).toSQL();

    expect(sql).toContain('"customers"."companyId" = ?');
    expect(sql.toLowerCase()).not.toContain("join");
    expect(sql).not.toContain("companies");
    expect(bindings).toEqual([7]);
  });

  it("honours a non-default company column", () => {
    const { sql, bindings } = applyCompanyScope(
      knex("warehouses").select("warehouses.*"),
      "warehouses",
      7,
      "company_id",
    ).toSQL();

    expect(sql).toContain('"warehouses"."company_id" = ?');
    expect(bindings).toEqual([7]);
  });

  it("leaves the query unchanged when companyId is undefined", () => {
    const unscoped = knex("customers").select("customers.*").toSQL();
    const scoped = applyCompanyScope(
      knex("customers").select("customers.*"),
      "customers",
      undefined,
    ).toSQL();

    expect(scoped.sql).toBe(unscoped.sql);
    expect(scoped.bindings).toEqual(unscoped.bindings);
  });

  it("matches nothing for an unresolved company, never degrading to no scope (T1/D-98)", () => {
    const unscoped = knex("customers").select("customers.*").toSQL();
    const { sql, bindings } = applyCompanyScope(
      knex("customers").select("customers.*"),
      "customers",
      UNRESOLVED_COMPANY,
    ).toSQL();

    expect(sql).toBe(`${unscoped.sql} where false`);
    expect(bindings).toEqual([]);
  });
});

describe("applyCompanyScopeViaWarehouse", () => {
  it("keeps exactly one join, to warehouses, and filters its company_id", () => {
    const { sql, bindings } = applyCompanyScopeViaWarehouse(
      knex("paper_stock").select("paper_stock.*"),
      "paper_stock",
      7,
    ).toSQL();

    expect(sql.toLowerCase().match(/join/g)).toHaveLength(1);
    expect(sql).toContain(
      'inner join "warehouses" on "paper_stock"."warehouseId" = "warehouses"."id"',
    );
    expect(sql).toContain('"warehouses"."company_id" = ?');
    expect(sql).not.toContain("companies");
    expect(bindings).toEqual([7]);
  });

  it("leaves the query unchanged when companyId is undefined", () => {
    const unscoped = knex("paper_stock").select("paper_stock.*").toSQL();
    const scoped = applyCompanyScopeViaWarehouse(
      knex("paper_stock").select("paper_stock.*"),
      "paper_stock",
      undefined,
    ).toSQL();

    expect(scoped.sql).toBe(unscoped.sql);
  });

  it("matches nothing for an unresolved company (T1/D-98)", () => {
    const { sql } = applyCompanyScopeViaWarehouse(
      knex("paper_stock").select("paper_stock.*"),
      "paper_stock",
      UNRESOLVED_COMPANY,
    ).toSQL();

    expect(sql).toMatch(/ where false$/);
  });
});

describe("companyFilterScope — precedence of list and ownership reads (T1/D-97)", () => {
  it("scopes a user to the id resolved from their token", () => {
    expect(
      companyFilterScope(
        requestAs("member", { tokenCompany: COMPANY_A, companyId: 7 }),
      ),
    ).toBe(7);
  });

  it("gives a superAdmin with no selection no scope", () => {
    expect(companyFilterScope(requestAs("superAdmin"))).toBeUndefined();
  });

  it("scopes a superAdmin to their ?companyId selection", () => {
    expect(
      companyFilterScope(
        requestAs("superAdmin", {
          query: { companyId: COMPANY_B },
          companyId: 9,
        }),
      ),
    ).toBe(9);
  });

  it("ignores a superAdmin's body.companyId on these reads, as getCompanyFilterUuid does", () => {
    // `authenticate` resolved the body company into req.companyId (getCompanyScope
    // precedence); a list or ownership read must still see all companies.
    expect(
      companyFilterScope(
        requestAs("superAdmin", {
          body: { companyId: COMPANY_B },
          companyId: 9,
        }),
      ),
    ).toBeUndefined();
  });

  it("ignores an unresolvable superAdmin body.companyId too — no scope, as today", () => {
    expect(
      companyFilterScope(
        requestAs("superAdmin", { body: { companyId: COMPANY_B } }),
      ),
    ).toBeUndefined();
  });
});

describe("companyFilterScope — fail closed (T1/D-98)", () => {
  it("answers UNRESOLVED_COMPANY for a user whose token company no longer resolves", () => {
    expect(
      companyFilterScope(requestAs("member", { tokenCompany: COMPANY_A })),
    ).toBe(UNRESOLVED_COMPANY);
  });

  it("answers UNRESOLVED_COMPANY for a superAdmin selection that did not resolve", () => {
    expect(
      companyFilterScope(
        requestAs("superAdmin", { query: { companyId: COMPANY_B } }),
      ),
    ).toBe(UNRESOLVED_COMPANY);
  });

  it("turns a stale token into a list that matches nothing", () => {
    const query = applyCompanyScope(
      knex("customers").select("customers.*"),
      "customers",
      companyFilterScope(requestAs("admin", { tokenCompany: COMPANY_A })),
    );

    expect(query.toSQL().sql).toMatch(/ where false$/);
  });
});
