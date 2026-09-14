import type { PurgeHook } from "../module.types";

/**
 * The node-files tables carry `companyId` with no foreign key to `companies`,
 * so the cascade never reaches them and they are deleted explicitly
 * (db-per-company T0, finding F-1; model D-64: this is the entity's only
 * deletion strategy, now and after the split). Children before parents, so the
 * order is safe whatever each foreign key's delete rule is (`nf_runs.workflowId`
 * is RESTRICT); `__tests__/db/company-purge.db.test.ts` checks it against
 * `pg_constraint`.
 */
export const NODE_FILES_PURGE_ORDER = [
  "nf_node_runs",
  "nf_runs",
  "nf_documents",
  "nf_workflow_credentials",
  "nf_workflows",
  "nf_credentials",
] as const;

export const nodeFilesPurgeHook: PurgeHook = {
  slug: "node-files",
  companyRows: "explicit",
  tables: NODE_FILES_PURGE_ORDER,
  purgeCompany: async (trx, companyId) => {
    for (const table of NODE_FILES_PURGE_ORDER) {
      // Raw, because the purge's transaction is guarded as `core` while the
      // tenant plane shares its database, and the wrong-database guard rejects
      // a tenant-owned table name there. A second transaction on the tenant key
      // is not an option: see "One transaction per physical DATABASE" in
      // `company-purge.service.ts`.
      await trx.raw('delete from ?? where "companyId" = ?', [table, companyId]);
    }
  },
};
