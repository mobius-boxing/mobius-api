/**
 * Where the company filter on a list request comes from.
 *
 * This is the single chokepoint for tenant isolation on reads: every DAO's
 * `getAllWithFilters` lifts `filters.companyId` out of `parseQueryParams` and
 * turns it into a join on `companies.uuid`. If the value can be chosen by the
 * caller, every list endpoint in the API leaks across tenants at once.
 *
 * It could be, and was. The scoping used to live in `enforceCompanyFilter(req)`,
 * called from the controllers, which assigned to `req.query.companyId`. Under
 * Express 5 `req.query` is a getter that re-parses the query string on every
 * access, so the assignment never survived the return — the function was a
 * no-op and non-superAdmins were never scoped. A plain admin listing customers
 * got every company's customers.
 *
 * The regression these tests exist to catch is a silent one: nothing throws,
 * nothing 500s, the list just contains rows it should not. So the load-bearing
 * case is INJECTION — a caller naming someone else's company must not win.
 */
import { describe, it, expect } from "@jest/globals";
import { Request } from "express";
import { parseQueryParams } from "../../../utils/queryBuilder";

const OWN_COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "22222222-2222-2222-2222-222222222222";

const asRequest = (
  query: Record<string, string>,
  user?: { role: string; companyId?: string },
): Request => ({ query, user }) as unknown as Request;

describe("parseQueryParams — company scoping", () => {
  describe("a regular user", () => {
    it("is scoped to the company in their token", () => {
      const parsed = parseQueryParams(
        asRequest({}, { role: "member", companyId: OWN_COMPANY }),
      );

      expect(parsed.filters.companyId).toBe(OWN_COMPANY);
    });

    it("cannot widen the scope by naming another company", () => {
      const parsed = parseQueryParams(
        asRequest(
          { companyId: OTHER_COMPANY },
          { role: "member", companyId: OWN_COMPANY },
        ),
      );

      expect(parsed.filters.companyId).toBe(OWN_COMPANY);
    });

    it("cannot drop the scope by sending an empty company", () => {
      const parsed = parseQueryParams(
        asRequest({ companyId: "" }, { role: "admin", companyId: OWN_COMPANY }),
      );

      expect(parsed.filters.companyId).toBe(OWN_COMPANY);
    });
  });

  describe("an admin", () => {
    // The reported bug: an admin of one tenant saw another tenant's rows on
    // every list screen, without asking for them.
    it("is scoped even when the client sends no company at all", () => {
      const parsed = parseQueryParams(
        asRequest(
          { page: "1", limit: "20" },
          { role: "admin", companyId: OWN_COMPANY },
        ),
      );

      expect(parsed.filters.companyId).toBe(OWN_COMPANY);
    });
  });

  describe("a superAdmin", () => {
    it("targets the company they select", () => {
      const parsed = parseQueryParams(
        asRequest({ companyId: OTHER_COMPANY }, { role: "superAdmin" }),
      );

      expect(parsed.filters.companyId).toBe(OTHER_COMPANY);
    });

    it("sees every company when they select none", () => {
      const parsed = parseQueryParams(asRequest({}, { role: "superAdmin" }));

      expect(parsed.filters.companyId).toBeUndefined();
      expect("companyId" in parsed.filters).toBe(false);
    });
  });

  it("leaves the other filters, paging and sort untouched", () => {
    const parsed = parseQueryParams(
      asRequest(
        {
          page: "3",
          limit: "50",
          sortBy: "code",
          sortOrder: "desc",
          search: "caja",
          active: "true",
        },
        { role: "admin", companyId: OWN_COMPANY },
      ),
    );

    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
    expect(parsed.sortBy).toBe("code");
    expect(parsed.sortOrder).toBe("desc");
    expect(parsed.search).toBe("caja");
    expect(parsed.filters.active).toBe("true");
  });

  // The mechanism behind the original bug, pinned so it cannot quietly return:
  // any fix that scopes by writing back to req.query is dead on arrival.
  it("does not rely on mutating req.query, which Express 5 discards", () => {
    const req = asRequest({}, { role: "member", companyId: OWN_COMPANY });
    parseQueryParams(req);

    expect((req.query as Record<string, unknown>).companyId).toBeUndefined();
  });
});
