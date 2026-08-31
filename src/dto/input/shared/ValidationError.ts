/**
 * Field-level input validation errors.
 *
 * `inputValidator` (@sundaysf/utils) only rejects empty objects, so a `build()`
 * that does not throw is validation theater. These two classes give `build()`
 * something to throw that the error middleware can turn into a 400 carrying a
 * per-field breakdown the form can pin on its inputs.
 *
 * SECURITY: every message here is author-written Spanish built from a DTO field
 * name the caller just submitted. Nothing in `errors` ever comes from pg or
 * knex, which is what lets `error.middleware.ts` exempt THIS class (and only
 * this class) from the DEBUG_ERRORS gate.
 */

export interface IFieldError {
  field: string;
  message: string;
}

/** A single field's failure. Aggregated by `collect` into a `ValidationError`. */
export class FieldValidationError extends Error {
  public readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "FieldValidationError";
    this.field = field;
    // `extends Error` + ES2016 target loses the prototype chain without this.
    Object.setPrototypeOf(this, FieldValidationError.prototype);
  }
}

/**
 * The aggregate thrown out of `build()`. `name`/`isValidationError`/`statusCode`
 * match what `error.middleware.ts` already looks for, so no routing changes.
 */
export class ValidationError extends Error {
  public readonly isValidationError = true;
  public readonly statusCode = 400;
  public readonly errors: IFieldError[];

  constructor(errors: IFieldError[]) {
    super(errors[0]?.message ?? "Los datos enviados no son válidos");
    this.name = "ValidationError";
    this.errors = errors;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Runs `fn` and, when it throws, records the failure against `name` instead of
 * propagating — so a form with three bad fields gets three errors back rather
 * than only the first one.
 */
export type FieldRunner = <V>(name: string, fn: () => V) => V;

/**
 * Aggregating wrapper for a DTO's `build()`:
 *
 * ```ts
 * collect((field) => {
 *   this.code = field("code", () => requiredText(this.code, 50, "El código"));
 * });
 * ```
 *
 * Every field is attempted; if any failed, a single `ValidationError` carrying
 * all of them is thrown once `build` returns.
 */
export function collect<T>(build: (field: FieldRunner) => T): T {
  const errors: IFieldError[] = [];

  const field: FieldRunner = <V>(name: string, fn: () => V): V => {
    try {
      return fn();
    } catch (err) {
      const isField = err instanceof FieldValidationError;
      errors.push({
        field: isField ? err.field || name : name,
        message: err instanceof Error ? err.message : String(err),
      });
      // The caller stores this and keeps going; it is never read, because a
      // non-empty `errors` throws before `build`'s result is used.
      return undefined as unknown as V;
    }
  };

  const result = build(field);

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return result;
}
