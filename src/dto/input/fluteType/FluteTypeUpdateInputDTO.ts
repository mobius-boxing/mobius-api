import {
  clearableText,
  codeText,
  optionalNumber,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  FLUTE_TYPE_LABELS,
  FLUTE_TYPE_LIMITS,
} from "./FluteTypeCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. `code` is still validated when present: the column is
 * `notNullable`, so blanking it must fail here rather than as a NOT NULL
 * violation whose knex message carries the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class FluteTypeUpdateInputDTO {
  code?: string;
  description?: string | null;
  fluteFactor?: number;
  length?: number;
  width?: number;
  height?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) this.code = source.code as string;
    if (source.description !== undefined) {
      this.description = source.description as string | null;
    }
    if (source.fluteFactor !== undefined) {
      this.fluteFactor = source.fluteFactor as number;
    }
    if (source.length !== undefined) this.length = source.length as number;
    if (source.width !== undefined) this.width = source.width as number;
    if (source.height !== undefined) this.height = source.height as number;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, FLUTE_TYPE_LIMITS.code, FLUTE_TYPE_LABELS.code),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            FLUTE_TYPE_LIMITS.description,
            FLUTE_TYPE_LABELS.description,
          ),
        );
      }
      if (this.fluteFactor !== undefined) {
        this.fluteFactor = field("fluteFactor", () =>
          optionalNumber(
            this.fluteFactor,
            FLUTE_TYPE_LIMITS.measure,
            FLUTE_TYPE_LABELS.fluteFactor,
          ),
        );
      }
      if (this.length !== undefined) {
        this.length = field("length", () =>
          optionalNumber(
            this.length,
            FLUTE_TYPE_LIMITS.measure,
            FLUTE_TYPE_LABELS.length,
          ),
        );
      }
      if (this.width !== undefined) {
        this.width = field("width", () =>
          optionalNumber(
            this.width,
            FLUTE_TYPE_LIMITS.measure,
            FLUTE_TYPE_LABELS.width,
          ),
        );
      }
      if (this.height !== undefined) {
        this.height = field("height", () =>
          optionalNumber(
            this.height,
            FLUTE_TYPE_LIMITS.measure,
            FLUTE_TYPE_LABELS.height,
          ),
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
