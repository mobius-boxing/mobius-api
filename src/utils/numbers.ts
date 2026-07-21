/**
 * Shared numeric coercion for DTO inputs and DAO row mapping. Sprint 2 grew
 * nine hand-rolled `num()`/`int()` copies with drifting semantics (some let
 * NaN or null reach double-precision columns) — these two helpers are the
 * single source.
 */

/**
 * DTO-side: treat undefined / null / '' / non-numeric strings as "not
 * provided" so NaN and null can never be persisted into numeric columns.
 */
export function toNumberInput(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const parsed = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof parsed === "number" && !Number.isNaN(parsed) ? parsed : undefined;
}

/** DTO-side integer variant (same guards, parseInt semantics). */
export function toIntInput(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const parsed = typeof v === "string" ? parseInt(v, 10) : Math.trunc(v as number);
  return typeof parsed === "number" && !Number.isNaN(parsed) ? parsed : undefined;
}

/**
 * DAO-side: pg returns decimal/numeric columns as strings; normalize to
 * number, mapping null/undefined to null for the API surface.
 */
export function toNumberOut(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const parsed = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isNaN(parsed) ? null : parsed;
}
