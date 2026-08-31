import {
  clearableText,
  codeText,
  optionalInt,
  optionalUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/color.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30),
 * not from migrations (AMENDMENT A1):
 *   colors.code         varchar(400) NULL, UNIQUE ("companyId", code)
 *   colors.name         varchar(255) NULL
 *   colors.description  text         NULL
 *   colors.observations text         NULL
 *   colors.tonality     integer      NULL, no CHECK constraint
 *   colors.colorTypeId  integer      NULL (FK; the DTO takes the uuid)
 *
 * SIGN-OFF: `code` is NULLABLE in the column but REQUIRED here, mirroring the
 * client rule the modal has always enforced. Same call as `delivery_zones.code`
 * and `fsc_types.code` in B2 — sloppy schema, not intended nullability. A
 * follow-up card adds NOT NULL.
 *
 * `tonality` was `parseInt(x, 10)` in the constructor, which turns `"abc"` into
 * `NaN` and hands Postgres an invalid integer literal. `optionalInt` rejects it
 * as a field error instead — the whole point of this batch.
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token (L-009).
 *
 * The update DTO imports these so the two can never drift apart.
 */
export const COLOR_LIMITS = {
  code: 400,
  name: 255,
  text: 10000,
  /** Plain `integer`, no CHECK: int32 is the only real ceiling. */
  tonality: { min: 0, max: 2147483647 },
};

export const COLOR_LABELS = {
  code: "El código",
  name: "El nombre",
  description: "La descripción",
  observations: "Las observaciones",
  tonality: "La tonalidad",
  colorTypeUuid: "El tipo de color",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ColorCreateInputDTO {
  code: string;
  name?: string | null;
  description?: string | null;
  observations?: string | null;
  tonality?: number;
  // SECURITY: Accept UUID from frontend, not numeric ID
  colorTypeUuid?: string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string | null | undefined;
    this.description = source.description as string | null | undefined;
    this.observations = source.observations as string | null | undefined;
    this.tonality = source.tonality as number | undefined;
    this.colorTypeUuid = source.colorTypeUuid as string | undefined;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, COLOR_LIMITS.code, COLOR_LABELS.code),
      );
      this.name = field("name", () =>
        clearableText(this.name, COLOR_LIMITS.name, COLOR_LABELS.name),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          COLOR_LIMITS.text,
          COLOR_LABELS.description,
        ),
      );
      this.observations = field("observations", () =>
        clearableText(
          this.observations,
          COLOR_LIMITS.text,
          COLOR_LABELS.observations,
        ),
      );
      this.tonality = field("tonality", () =>
        optionalInt(this.tonality, COLOR_LIMITS.tonality, COLOR_LABELS.tonality),
      );
      this.colorTypeUuid = field("colorTypeUuid", () =>
        optionalUuid(this.colorTypeUuid, COLOR_LABELS.colorTypeUuid),
      );
    });

    // `inputValidator` rejects ANY own key holding `undefined`, so a blank
    // optional field used to 400 a request the nullable column would accept.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
