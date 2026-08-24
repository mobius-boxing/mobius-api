/**
 * The four database keys of the split (spec G-1, as amended 2026-08-24: the
 * `store` key was removed with the store module and `nodefiles` took the
 * connections it freed).
 *
 * `erp` — not `mobius` — is the ERP key: inside a platform called Mobius,
 * `db("mobius")` would read as "the whole platform". This is a code-level
 * naming concern only; no `modules.slug` value in the core catalogue changes.
 *
 * `nodefiles` has NO hyphen while the module it serves is `node-files`
 * everywhere else (slug, route path, permission code, npm workspace). The key
 * becomes a database name — `mobius_nodefiles_production` — and a hyphen there
 * would have to be quoted in every psql session. Precedent for one module
 * carrying two spellings: countdown's public domain label is `vencimientos`.
 */
export const DB_KEYS = ["core", "erp", "countdown", "nodefiles"] as const;

export type DbKey = (typeof DB_KEYS)[number];

export const isDbKey = (value: string): value is DbKey =>
  (DB_KEYS as readonly string[]).includes(value);
