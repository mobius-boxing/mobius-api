/**
 * Shared query-parameter validators for list endpoints.
 *
 * L-007: every documented param is either wired or REJECTED. A param that is
 * accepted and silently ignored — a 200 with an unfiltered list — is the
 * failure mode these helpers exist to prevent.
 *
 * They also keep malformed input off the database. Handing an `Invalid Date`
 * or a non-uuid string to Postgres raises 22007/22P02 deep inside the driver,
 * which surfaces as a 500 whose body can echo the generated SQL.
 */

/** UUID v4, byte-identical to validation.middleware.ts:112-113. */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A malformed filter value. `name = "ValidationError"` is what makes
 * error.middleware.ts answer 400 `{ code: "VALIDATION_ERROR" }`.
 */
export class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** `"true"` / `"false"` / absent. Anything else is a 400. */
export function parseTriStateParam(
  name: string,
  raw: unknown,
): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new FilterValidationError(
    `Invalid value for ${name}: expected "true" or "false"`,
  );
}

/** An ISO-8601 date or datetime; anything unparseable is a 400. */
export function parseDateParam(name: string, raw: unknown): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) {
    throw new FilterValidationError(
      `Invalid value for ${name}: expected an ISO-8601 date`,
    );
  }
  return parsed;
}

/** A UUID-shaped value; anything else is a 400 (never an unfiltered 200). */
export function assertUuidParam(
  name: string,
  raw: unknown,
): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = String(raw);
  if (!UUID_V4_PATTERN.test(value)) {
    throw new FilterValidationError(
      `Invalid value for ${name}: expected a UUID`,
    );
  }
  return value;
}

/** One of a fixed set of enum values; anything else is a 400. */
export function parseEnumParam<T extends string>(
  name: string,
  raw: unknown,
  allowed: readonly T[],
): T | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = String(raw) as T;
  if (!allowed.includes(value)) {
    throw new FilterValidationError(
      `Invalid value for ${name}: expected one of ${allowed.join(", ")}`,
    );
  }
  return value;
}
