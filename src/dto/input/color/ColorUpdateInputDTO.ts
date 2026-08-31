import {
  clearableText,
  codeText,
  optionalInt,
  optionalUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { COLOR_LABELS, COLOR_LIMITS } from "./ColorCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. `null` is preserved where the column is nullable, because clearing
 * a field is a legitimate edit and must not be confused with omitting it.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ColorUpdateInputDTO {
  code?: string;
  name?: string | null;
  description?: string | null;
  observations?: string | null;
  tonality?: number | null;
  // SECURITY: Accept UUID from frontend, not numeric ID
  colorTypeUuid?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) this.code = source.code as string;
    if (source.name !== undefined) this.name = source.name as string | null;
    if (source.description !== undefined)
      this.description = source.description as string | null;
    if (source.observations !== undefined)
      this.observations = source.observations as string | null;
    if (source.tonality !== undefined)
      this.tonality = source.tonality as number | null;
    if (source.colorTypeUuid !== undefined)
      this.colorTypeUuid = source.colorTypeUuid as string | null;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, COLOR_LIMITS.code, COLOR_LABELS.code),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          clearableText(this.name, COLOR_LIMITS.name, COLOR_LABELS.name),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            COLOR_LIMITS.text,
            COLOR_LABELS.description,
          ),
        );
      }
      if (this.observations !== undefined) {
        this.observations = field("observations", () =>
          clearableText(
            this.observations,
            COLOR_LIMITS.text,
            COLOR_LABELS.observations,
          ),
        );
      }
      // `null` clears the column; only a present, non-null value is bounded.
      if (this.tonality !== undefined && this.tonality !== null) {
        this.tonality = field("tonality", () =>
          optionalInt(
            this.tonality,
            COLOR_LIMITS.tonality,
            COLOR_LABELS.tonality,
          ),
        );
      }
      if (this.colorTypeUuid !== undefined && this.colorTypeUuid !== null) {
        this.colorTypeUuid = field("colorTypeUuid", () =>
          optionalUuid(this.colorTypeUuid, COLOR_LABELS.colorTypeUuid),
        );
      }
    });

    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
