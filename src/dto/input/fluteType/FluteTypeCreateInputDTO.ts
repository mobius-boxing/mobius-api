import {
  clearableText,
  codeText,
  optionalNumber,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Straight from `20251101162721_create_flute_types_table.ts`:
 *   code        varchar(50) NOT NULL UNIQUE
 *   description text NULL          (10000 is the project-wide text archetype)
 *   fluteFactor / length / width / height  numeric(8,2) NULL
 *
 * The update DTO imports these so the two can never drift apart.
 */
export const FLUTE_TYPE_LIMITS = {
  code: 50,
  description: 10000,
  measure: { min: 0, max: 999999.99, decimals: 2 },
};

export const FLUTE_TYPE_LABELS = {
  code: "El código",
  description: "La descripción",
  fluteFactor: "El factor de onda",
  length: "El largo",
  width: "El ancho",
  height: "El alto",
};

/**
 * Mirrors `src/validation/schemas/fluteType.ts` in mobius-web-app. Bounds come
 * from `20251101162721_create_flute_types_table.ts`; `companyId` is NOT a DTO
 * field — `BaseCrudController.create` injects it from the caller's token after
 * `buildCreateDTO` returns (L-009), so nothing here may strip it.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class FluteTypeCreateInputDTO {
  code: string;
  description?: string | null;
  fluteFactor?: number;
  length?: number;
  width?: number;
  height?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.description = source.description as string | null | undefined;
    this.fluteFactor = source.fluteFactor as number | undefined;
    this.length = source.length as number | undefined;
    this.width = source.width as number | undefined;
    this.height = source.height as number | undefined;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, FLUTE_TYPE_LIMITS.code, FLUTE_TYPE_LABELS.code),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          FLUTE_TYPE_LIMITS.description,
          FLUTE_TYPE_LABELS.description,
        ),
      );
      this.fluteFactor = field("fluteFactor", () =>
        optionalNumber(
          this.fluteFactor,
          FLUTE_TYPE_LIMITS.measure,
          FLUTE_TYPE_LABELS.fluteFactor,
        ),
      );
      this.length = field("length", () =>
        optionalNumber(
          this.length,
          FLUTE_TYPE_LIMITS.measure,
          FLUTE_TYPE_LABELS.length,
        ),
      );
      this.width = field("width", () =>
        optionalNumber(
          this.width,
          FLUTE_TYPE_LIMITS.measure,
          FLUTE_TYPE_LABELS.width,
        ),
      );
      this.height = field("height", () =>
        optionalNumber(
          this.height,
          FLUTE_TYPE_LIMITS.measure,
          FLUTE_TYPE_LABELS.height,
        ),
      );
    });

    // BUGFIX: `inputValidator` rejects ANY own key holding `undefined`
    // ("Param length is missing"), so leaving an optional measure blank used to
    // answer 400 even though the column is nullable and the placeholder says
    // "(optional)". Unset keys are dropped, exactly as the update DTO does.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
