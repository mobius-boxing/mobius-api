import { FieldValidationError } from "./ValidationError";

/**
 * Shared input helpers for every DTO's `build()`. Everything here THROWS in
 * Spanish: `inputValidator` (@sundaysf/utils) only rejects empty objects, so a
 * `build()` that does not throw is validation theater (host rule).
 *
 * Originally written for the node-files DTOs
 * (`../node-files/NodeFilesFieldsInput.ts`, which now re-exports from here);
 * the text helpers keep their `(value, max, label)` argument order so that move
 * changed no call site. The numeric/uuid/date helpers follow the same shape
 * with an options object in the `max` slot: `(value, options, label)`.
 *
 * Bounds are NOT guesswork: every `max` a caller passes must come from the
 * column's migration (`varchar(n)`, `numeric(p,s)`), never from a copy-pasted
 * inline form rule.
 */

/** Rejected with an empty `field`; `collect` fills in the DTO property name. */
const fail = (message: string): never => {
  throw new FieldValidationError("", message);
};

export function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export function requiredText(
  value: unknown,
  max: number,
  label: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(`${label} es obligatorio`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return fail(`${label} no puede superar los ${max} caracteres`);
  }
  return trimmed;
}

/**
 * Codes are identifiers: letters, digits, `_ . - /` and spaces. Byte-identical
 * to `CODE_PATTERN` in `mobius-web-app/src/validation/fields.ts` — the client
 * rule and this one must never disagree, so copy any change to both.
 *
 * Quantified `*`, not `+`, for the same reason as the client: emptiness is
 * `requiredText`'s job and reporting BOTH "es obligatorio" and "formato
 * inválido" for one blank field is noise.
 */
const CODE_PATTERN = /^[\w.\-/ ]*$/;

/**
 * `requiredText` plus the client's `code` character class. The value is
 * trimmed FIRST and the class then checked on the trimmed value, exactly as
 * zod's `.trim().min(1).max(n).regex(...)` chain does — so a padded `" AB "`
 * passes on both sides while an inner `A+B` fails on both.
 *
 * `max` is the column's real `varchar(n)` (50 / 100 / 400 across the swept
 * lookups): pass the entity's own `<ENTITY>_LIMITS.code`, never a shared
 * constant.
 */
export function codeText(value: unknown, max: number, label: string): string {
  const trimmed = requiredText(value, max, label);
  if (!CODE_PATTERN.test(trimmed)) {
    return fail(`${label} tiene un formato inválido`);
  }
  return trimmed;
}

export function optionalText(
  value: unknown,
  max: number,
  label: string,
): string | null | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return fail(`${label} debe ser texto`);
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    return fail(`${label} no puede superar los ${max} caracteres`);
  }
  return trimmed;
}

/**
 * Like `optionalText`, but an explicit empty string stays an empty string
 * instead of vanishing. Update DTOs strip `undefined` keys, so mapping `""` to
 * `undefined` would silently make a field impossible to CLEAR.
 */
export function clearableText(
  value: unknown,
  max: number,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return fail(`${label} debe ser texto`);
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return fail(`${label} no puede superar los ${max} caracteres`);
  }
  return trimmed;
}

export function toBoolean(value: unknown, label: string): boolean | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fail(`${label} debe ser verdadero o falso`);
}

export interface NumberBounds {
  /** Defaults to 0: no column in this schema stores a negative measure. */
  min?: number;
  /** The column's `numeric(p,s)` maximum, e.g. 999999.99 for numeric(8,2). */
  max?: number;
  /** The column's `numeric(p,s)` scale. Omit for unconstrained scale. */
  decimals?: number;
}

/** `1.005` at 2 decimals fails; `1.5` at 2 decimals passes. */
const hasTooManyDecimals = (value: number, decimals: number): boolean =>
  Number(value.toFixed(decimals)) !== value;

function parseNumber(value: unknown, label: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail(`${label} debe ser un número`);
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) return fail(`${label} debe ser un número`);
    return parsed;
  }
  return fail(`${label} debe ser un número`);
}

function checkBounds(
  value: number,
  bounds: NumberBounds,
  label: string,
): number {
  const min = bounds.min ?? 0;
  if (value < min) return fail(`${label} no puede ser menor que ${min}`);
  if (bounds.max !== undefined && value > bounds.max) {
    return fail(`${label} no puede ser mayor que ${bounds.max}`);
  }
  if (
    bounds.decimals !== undefined &&
    hasTooManyDecimals(value, bounds.decimals)
  ) {
    return fail(
      `${label} admite como máximo ${bounds.decimals} ${
        bounds.decimals === 1 ? "decimal" : "decimales"
      }`,
    );
  }
  return value;
}

export function requiredNumber(
  value: unknown,
  bounds: NumberBounds,
  label: string,
): number {
  if (emptyToUndefined(value) === undefined || value === null) {
    return fail(`${label} es obligatorio`);
  }
  return checkBounds(parseNumber(value, label), bounds, label);
}

/**
 * The `NaN` guard. `parseFloat("")` is `NaN`, and a `NaN` handed to knex
 * reaches Postgres as an invalid numeric literal — the silent-corruption bug
 * this helper exists to close. Empty/absent means "leave the column alone".
 */
export function optionalNumber(
  value: unknown,
  bounds: NumberBounds,
  label: string,
): number | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  return checkBounds(parseNumber(raw, label), bounds, label);
}

export function requiredInt(
  value: unknown,
  bounds: NumberBounds,
  label: string,
): number {
  const parsed = requiredNumber(value, bounds, label);
  if (!Number.isInteger(parsed)) {
    return fail(`${label} debe ser un número entero`);
  }
  return parsed;
}

export function optionalInt(
  value: unknown,
  bounds: NumberBounds,
  label: string,
): number | undefined {
  const parsed = optionalNumber(value, bounds, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    return fail(`${label} debe ser un número entero`);
  }
  return parsed;
}

/**
 * Any RFC-4122 layout, not v4 specifically: rows predating `gen_random_uuid()`
 * carry legacy uuids and must stay referenceable.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requiredUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    return fail(`${label} es obligatorio`);
  }
  return value.trim();
}

export function optionalUuid(
  value: unknown,
  label: string,
): string | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw.trim())) {
    return fail(`${label} no es válido`);
  }
  return raw.trim();
}

/**
 * Deliberately permissive, and byte-identical to `EMAIL_PATTERN` in
 * `mobius-web-app/src/validation/fields.ts`: the mail provider is the real
 * judge of deliverability, so this only rejects what is obviously not an
 * address. Copy any change to both files.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailText(value: unknown, max: number, label: string): string {
  const trimmed = requiredText(value, max, label);
  if (!EMAIL_PATTERN.test(trimmed)) {
    return fail(`${label} no es válido`);
  }
  return trimmed;
}

/**
 * A value constrained to a database CHECK constraint's list.
 *
 * `users.role` and `invitations.role` are the only columns in this schema with
 * a real CHECK — `CHECK (role = ANY (ARRAY['member','admin','superAdmin']))` —
 * so an out-of-list value is a 23514 whose message carries the constraint name,
 * not a silent write. Pass the constraint's own array from `pg_constraint`,
 * never a list copied from the client's dropdown.
 */
export function oneOfText<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(`${label} es obligatorio`);
  }
  const trimmed = value.trim() as T;
  if (!values.includes(trimmed)) {
    return fail(`${label} no es válido`);
  }
  return trimmed;
}

/**
 * A company reference that may arrive EITHER as a uuid (what the clients send)
 * or as a numeric id (what internal callers send).
 *
 * This exists because the old DTOs ran `parseInt(companyId, 10)` over the
 * value: on a uuid that yields the leading digits or `NaN`, so
 * `"3f2b…"` silently became company 3 and `"a1b2…"` became NaN. The users
 * controller already had a `/^\d+$/` guard for exactly this reason (SECURITY
 * C3); this helper is that guard, reusable, rejecting anything that is neither
 * shape instead of guessing.
 */
export function idOrUuid(
  value: unknown,
  label: string,
): number | string | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1) {
      return fail(`${label} no es válido`);
    }
    return raw;
  }
  if (typeof raw !== "string") return fail(`${label} no es válido`);
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (UUID_PATTERN.test(trimmed)) return trimmed;
  return fail(`${label} no es válido`);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const DDMMYYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Rejects impossible calendar dates (31/02) that `new Date` would roll over. */
const isRealDate = (y: number, m: number, d: number): boolean => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** Accepts `DD/MM/YYYY` and ISO; always returns `YYYY-MM-DD`. */
export function optionalDate(
  value: unknown,
  label: string,
): string | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime()))
      return fail(`${label} no es una fecha válida`);
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  }
  if (typeof raw !== "string") return fail(`${label} no es una fecha válida`);

  const text = raw.trim();
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isRealDate(y, m, d)) return fail(`${label} no es una fecha válida`);
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const local = DDMMYYYY.exec(text);
  if (local) {
    const [d, m, y] = [Number(local[1]), Number(local[2]), Number(local[3])];
    if (!isRealDate(y, m, d)) return fail(`${label} no es una fecha válida`);
    return `${local[3]}-${local[2]}-${local[1]}`;
  }

  return fail(`${label} no es una fecha válida`);
}

export function requiredDate(value: unknown, label: string): string {
  const parsed = optionalDate(value, label);
  if (parsed === undefined) return fail(`${label} es obligatorio`);
  return parsed;
}
