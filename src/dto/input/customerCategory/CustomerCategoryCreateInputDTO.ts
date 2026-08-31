import { requiredText } from "../shared/fieldValidators";
import { collect, FieldValidationError } from "../shared/ValidationError";

/**
 * Server mirror of
 * `mobius-web-app/src/validation/schemas/customerCategory.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   customer_categories.name varchar(255) NOT NULL, UNIQUE (companyId, name)
 *
 * SIGN-OFF (2026-08-29): the column is varchar(255) but the form has always
 * capped at 100 and required at least 2 characters. The column width is the
 * CEILING, not the target — widening the API to 255 would let the UI and the
 * API disagree about the same field, so the stricter existing rules are
 * mirrored here verbatim. `minLength` has no CHECK constraint behind it; it is
 * a UI convention kept as-is and extended to no other entity.
 *
 * `companyId` IS a field here — unlike the `BaseCrudController` entities, this
 * controller is hand-rolled and resolves the numeric company id from the
 * caller's token (or, for a superAdmin, from the body's company uuid) BEFORE
 * constructing this DTO. It is carried through untouched, never validated as a
 * form field, and never taken from raw input (L-009).
 */
export const CUSTOMER_CATEGORY_LIMITS = {
  /** The UI's long-standing cap; the column itself is varchar(255). */
  nameMax: 100,
  /** UI-only convention — no CHECK constraint backs it. */
  nameMin: 2,
};

export const CUSTOMER_CATEGORY_LABELS = {
  name: "El nombre",
};

/**
 * The one rule `fieldValidators` has no primitive for. Kept local rather than
 * added to the shared seam, because B2 is the only batch that needs it and a
 * shared `minLength` helper would invite spreading it to fields the sign-off
 * says must NOT get one.
 */
export function validateCategoryName(value: unknown): string {
  const name = requiredText(
    value,
    CUSTOMER_CATEGORY_LIMITS.nameMax,
    CUSTOMER_CATEGORY_LABELS.name,
  );
  if (name.length < CUSTOMER_CATEGORY_LIMITS.nameMin) {
    throw new FieldValidationError(
      "",
      `${CUSTOMER_CATEGORY_LABELS.name} debe tener al menos ${CUSTOMER_CATEGORY_LIMITS.nameMin} caracteres`,
    );
  }
  return name;
}

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class CustomerCategoryCreateInputDTO {
  name: string;
  companyId: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.companyId =
      typeof source.companyId === "string"
        ? parseInt(source.companyId, 10)
        : (source.companyId as number);
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () => validateCategoryName(this.name));
    });

    return this;
  }
}
