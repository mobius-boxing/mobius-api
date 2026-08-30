import { clearableText, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/colorType.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   color_types.name        varchar(255) NOT NULL
 *   color_types.description text        NULL
 *
 * `companyId` is NOT a DTO field — `BaseCrudController.create` injects it
 * from the caller's token after `buildCreateDTO` returns (L-009), so
 * nothing here may strip it.
 *
 * `color_types` has NO `code` column — it is name+description, the mirror
 * image of `box_types`/`manufacturers`.
 *
 * 10000 is the project-wide cap for a nullable `text` column (B1 convention).
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const COLOR_TYPE_LIMITS = {
  name: 255,
  description: 10000,
};

export const COLOR_TYPE_LABELS = {
  name: "El nombre",
  description: "La descripción",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ColorTypeCreateInputDTO {
  name: string;
  description?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.description = source.description as string | null | undefined;
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () =>
        requiredText(this.name, COLOR_TYPE_LIMITS.name, COLOR_TYPE_LABELS.name),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          COLOR_TYPE_LIMITS.description,
          COLOR_TYPE_LABELS.description,
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
