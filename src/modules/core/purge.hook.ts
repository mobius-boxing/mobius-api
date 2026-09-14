import type { PurgeHook } from "../module.types";

/**
 * L-006 strategy for the ERP tables, `files` and `code_sequences`/`app_config`:
 * every company row is removed by `ON DELETE CASCADE` from `companies` (directly
 * or through `warehouses`), which holds while the tenant shares the central
 * database. A dedicated tenant database is parked whole instead (brief D-38).
 * The ledger (`audit_logs`) is not this hook's: `purgeCompany` owns that door.
 */
export const corePurgeHook: PurgeHook = {
  slug: "core",
  companyRows: "cascade-from-companies",
};
