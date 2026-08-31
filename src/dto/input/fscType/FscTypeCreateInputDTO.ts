import { clearableText, codeText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/fscType.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   fsc_types.code        varchar(400) NULL
 *   fsc_types.description text         NULL
 *
 * `companyId` is NOT a DTO field — `BaseCrudController.create` injects it
 * from the caller's token after `buildCreateDTO` returns (L-009), so
 * nothing here may strip it.
 *
 * SIGN-OFF (2026-08-29): `code` is NULLABLE in the column but REQUIRED here,
 * mirroring the client rule. 0 of 46 rows lack a code and the form has never
 * accepted a blank one, so the nullability reads as sloppy schema; a follow-up
 * card adds NOT NULL. Relaxing the API instead would be a product regression.
 *
 * 10000 is the project-wide cap for a nullable `text` column (B1 convention).
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const FSC_TYPE_LIMITS = {
  code: 400,
  description: 10000,
};

export const FSC_TYPE_LABELS = {
  code: "El código",
  description: "La descripción",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class FscTypeCreateInputDTO {
  code: string;
  description?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.description = source.description as string | null | undefined;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, FSC_TYPE_LIMITS.code, FSC_TYPE_LABELS.code),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          FSC_TYPE_LIMITS.description,
          FSC_TYPE_LABELS.description,
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
