import { codeText, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/manufacturer.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   manufacturers.code varchar(100) NOT NULL
 *   manufacturers.name varchar(255) NOT NULL
 *   (no `description` column on this table)
 *
 * `companyId` is NOT a DTO field — `BaseCrudController.create` injects it
 * from the caller's token after `buildCreateDTO` returns (L-009), so
 * nothing here may strip it.
 *
 * `code` is varchar(100) here, not the 50 seen on most sibling tables — the
 * exact guess a shared constant would have gotten wrong.
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const MANUFACTURER_LIMITS = {
  code: 100,
  name: 255,
};

export const MANUFACTURER_LABELS = {
  code: "El código",
  name: "El nombre",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ManufacturerCreateInputDTO {
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
        codeText(this.code, MANUFACTURER_LIMITS.code, MANUFACTURER_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(
          this.name,
          MANUFACTURER_LIMITS.name,
          MANUFACTURER_LABELS.name,
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
