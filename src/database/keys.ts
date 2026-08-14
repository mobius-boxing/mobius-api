/**
 * The four database keys of the split (spec G-1).
 *
 * `erp` — not `mobius` — is the ERP key: inside a platform called Mobius,
 * `db("mobius")` would read as "the whole platform". This is a code-level
 * naming concern only; no `modules.slug` value in the core catalogue changes.
 */
export const DB_KEYS = ["core", "erp", "countdown", "store"] as const;

export type DbKey = (typeof DB_KEYS)[number];

export const isDbKey = (value: string): value is DbKey =>
  (DB_KEYS as readonly string[]).includes(value);
