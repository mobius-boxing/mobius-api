import type { PurgeHook } from "../module.types";

/**
 * L-006 strategy for the countdown tables: `ON DELETE CASCADE` from `companies`
 * reaches categories, documents, groups and digests, and their children cascade
 * from those, while the tenant shares the central database (brief D-38).
 */
export const countdownPurgeHook: PurgeHook = {
  slug: "countdown",
  companyRows: "cascade-from-companies",
};
