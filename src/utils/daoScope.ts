import type { Request } from "express";
import { Knex } from "knex";
import { getCompanyFilterUuid } from "./companyScope";

/**
 * A company was named — by the caller's token or a superAdmin's selection — but
 * no company has that uuid. A scoped query given this matches no row, as the
 * `companies.uuid` join it replaced did; degrading to "no scope" would hand a
 * stale token every company's rows.
 */
export const UNRESOLVED_COMPANY: unique symbol = Symbol("UNRESOLVED_COMPANY");

/** A company to scope to; `undefined` wherever it appears means "no scope". */
export type CompanyScope = number | typeof UNRESOLVED_COMPANY;

/**
 * The scope for reads that used `getCompanyFilterUuid` — every list (through
 * `parseQueryParams`) and every single-record ownership check.
 *
 * Precedence differs from `req.companyId`: a superAdmin's `body.companyId` never
 * scopes these reads, while `req.companyId` (resolved with `getCompanyScope`)
 * honours it. So the filter decides WHETHER to scope, and `req.companyId` only
 * supplies the id; with both a query and a body company, the query wins in both.
 */
export function companyFilterScope(req: Request): CompanyScope | undefined {
  if (!getCompanyFilterUuid(req)) return undefined;
  return req.companyId ?? UNRESOLVED_COMPANY;
}

/**
 * SECURITY (C2): company scoping as a local predicate on the table's own company
 * column — no `companies` join, because the caller already holds the numeric id
 * (`req.companyId`). A record of another company simply is not returned, which
 * callers map to 404 (IDOR protection).
 *
 * `undefined` (a superAdmin with no company selected) leaves the query untouched.
 */
export function applyCompanyScope(
  query: Knex.QueryBuilder,
  tableName: string,
  companyId?: CompanyScope,
  companyIdColumn: string = "companyId",
): Knex.QueryBuilder {
  if (companyId === UNRESOLVED_COMPANY) {
    query.whereRaw("false");
  } else if (companyId !== undefined) {
    query.where(`${tableName}.${companyIdColumn}`, companyId);
  }
  return query;
}

/**
 * SECURITY (C2): `applyCompanyScope` for tables whose company link is INDIRECT
 * through `warehouses` (paper_stock, sheet_stock, consumable_stock,
 * tooling_stock, warehouse_locations). The `warehouses` join is intra-tenant and
 * stays; only the `companies` hop is gone.
 */
export function applyCompanyScopeViaWarehouse(
  query: Knex.QueryBuilder,
  tableName: string,
  companyId?: CompanyScope,
  warehouseFkColumn: string = "warehouseId",
): Knex.QueryBuilder {
  if (companyId === UNRESOLVED_COMPANY) {
    query.whereRaw("false");
  } else if (companyId !== undefined) {
    query
      .join("warehouses", `${tableName}.${warehouseFkColumn}`, "warehouses.id")
      .where("warehouses.company_id", companyId);
  }
  return query;
}
