import { codeText, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/productType.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   product_types.code varchar(50) NOT NULL
 *   product_types.name varchar(255) NOT NULL
 *   (no `description` column on this table)
 *
 * `companyId` is NOT a DTO field — `BaseCrudController.create` injects it
 * from the caller's token after `buildCreateDTO` returns (L-009), so
 * nothing here may strip it.
 *
 * Same code+name shape as `box_types`; no `description` column exists.
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const PRODUCT_TYPE_LIMITS = {
  code: 50,
  name: 255,
};

export const PRODUCT_TYPE_LABELS = {
  code: "El código",
  name: "El nombre",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ProductTypeCreateInputDTO {
  code: string;
  name: string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, PRODUCT_TYPE_LIMITS.code, PRODUCT_TYPE_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(
          this.name,
          PRODUCT_TYPE_LIMITS.name,
          PRODUCT_TYPE_LABELS.name,
        ),
      );
    });

    // `inputValidator` (@sundaysf/utils) rejects ANY own key holding
    // `undefined` ("Param description is missing"), so an unset optional field
    // used to 400 a request the column would have accepted. Drop unset keys.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
