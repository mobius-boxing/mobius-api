import type { Knex } from "knex";
import type { DbKey } from "../database/keys";
import type { TABLE_MODULE } from "../database/ownership";

/** A catalogue slug, as `TABLE_MODULE` assigns them to tables. */
export type ModuleSlug = (typeof TABLE_MODULE)[string];

/**
 * A tenant column that holds a `users.id` without a foreign key, so the
 * catalogue (`crossPlaneRefs`) cannot report it. `purgeUser` sets a nullable
 * one to NULL and refuses on a NOT NULL one; `db-check-integrity` checks both.
 */
export type DeclaredUserReference = {
  table: string;
  column: string;
  nullable: boolean;
};

/** What `modules-sync` writes to the central `modules` catalogue. */
export type ModuleCatalogueEntry = {
  slug: string;
  name: string;
  description: string | null;
  isCore: boolean;
};

export type ModuleManifest = ModuleCatalogueEntry & {
  slug: ModuleSlug;
  /** The plane holding the module's tables (db-per-company D-36: every module is `tenant`). */
  plane: DbKey;
  userReferences: readonly DeclaredUserReference[];
};

/**
 * How a module's company rows disappear when `purgeCompany` runs (L-006: one
 * strategy per entity).
 */
export type PurgeHook =
  | { slug: ModuleSlug; companyRows: "cascade-from-companies" }
  | {
      slug: ModuleSlug;
      companyRows: "explicit";
      /** Every table the hook deletes from, in the order it deletes them. */
      tables: readonly string[];
      /** Runs inside the purge's transaction on the tenant's physical database. */
      purgeCompany: (trx: Knex.Transaction, companyId: number) => Promise<void>;
    };
