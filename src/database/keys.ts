/**
 * The two database planes (db-per-company D-3): `core` is the central database
 * (identity, tenancy, the module catalogue, RBAC, company-level assets and its
 * own ledger); `tenant` is one company's database, holding every module's
 * business tables.
 *
 * The module keys of the split (`erp`, `countdown`, `nodefiles`) are gone as
 * connection keys. Module membership survives as metadata in
 * `ownership.ts`'s `TABLE_MODULE`: keeping them as logical keys that all map to
 * the tenant pool would open one ambient transaction per module key on the
 * same physical database — the self-blocking shape `company-purge.service.ts`
 * documents.
 */
export const DB_KEYS = ["core", "tenant"] as const;

export type DbKey = (typeof DB_KEYS)[number];

/**
 * What a pool and an ambient transaction are actually keyed by: the central
 * database, or one tenant database (`number` = `tenant_databases.id`). Two
 * `DbKey`s that resolve to the same physical target share one `PhysicalKey`,
 * one instance and one transaction (D-13).
 */
export type PhysicalKey = "core" | `tenant:${number}`;

export const isDbKey = (value: string): value is DbKey =>
  (DB_KEYS as readonly string[]).includes(value);
