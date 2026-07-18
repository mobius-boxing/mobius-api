import { Knex } from "knex";

/**
 * SECURITY (C2): DRY company-scoping for single-record DAO reads (getByUuid / getIdByUuid).
 *
 * When `companyUuid` is provided, joins `companies` on the table's direct `companyId` column and
 * filters by `companies.uuid`. This doubles as an ownership check: a record belonging to another
 * company simply won't be returned (callers map that to a 404), preventing IDOR.
 *
 * When `companyUuid` is undefined (e.g. SuperAdmin with no company filter), the query is left
 * untouched so full cross-company access is preserved.
 *
 * Mirrors the join pattern used in CustomerDAO.getByUuid.
 *
 * @param query      a Knex query builder already scoped to `tableName`
 * @param tableName  the base table (e.g. "customers", "warehouses")
 * @param companyUuid the caller's company UUID, or undefined for no scoping
 * @param companyIdColumn the FK column on the table pointing at companies.id (default "companyId")
 */
export function applyCompanyUuidScope(
  query: Knex.QueryBuilder,
  tableName: string,
  companyUuid?: string,
  companyIdColumn: string = "companyId",
): Knex.QueryBuilder {
  if (companyUuid) {
    query
      .join("companies", `${tableName}.${companyIdColumn}`, "companies.id")
      .where("companies.uuid", companyUuid);
  }
  return query;
}

/**
 * SECURITY (C2): company-scoping for tables whose company link is INDIRECT through `warehouses`
 * (e.g. paper_stock, sheet_stock, consumable_stock, tooling_stock). These have no direct
 * `companyId` column; they reference a warehouse, which in turn carries `company_id`.
 *
 * When `companyUuid` is provided, joins `warehouses` (via the table's warehouse FK) → `companies`
 * and filters by `companies.uuid`. Undefined leaves the query untouched (SuperAdmin / no filter).
 *
 * @param query             a Knex query builder already scoped to `tableName`
 * @param tableName         the base stock table (e.g. "paper_stock")
 * @param companyUuid       the caller's company UUID, or undefined for no scoping
 * @param warehouseFkColumn the FK column on the table pointing at warehouses.id (default "warehouseId")
 */
export function applyCompanyUuidScopeViaWarehouse(
  query: Knex.QueryBuilder,
  tableName: string,
  companyUuid?: string,
  warehouseFkColumn: string = "warehouseId",
): Knex.QueryBuilder {
  if (companyUuid) {
    query
      .join("warehouses", `${tableName}.${warehouseFkColumn}`, "warehouses.id")
      .join("companies", "warehouses.company_id", "companies.id")
      .where("companies.uuid", companyUuid);
  }
  return query;
}
