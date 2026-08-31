import { clearableText, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  COLOR_TYPE_LABELS,
  COLOR_TYPE_LIMITS,
} from "./ColorTypeCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are validated with the create rules: blanking a
 * required one must fail here rather than as a NOT NULL violation whose knex
 * message carries the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ColorTypeUpdateInputDTO {
  name?: string;
  description?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.name !== undefined) {
      this.name = source.name as string;
    }
    if (source.description !== undefined) {
      this.description = source.description as string | null;
    }
  }

  public build(): this {
    collect((field) => {
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            COLOR_TYPE_LIMITS.name,
            COLOR_TYPE_LABELS.name,
          ),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            COLOR_TYPE_LIMITS.description,
            COLOR_TYPE_LABELS.description,
          ),
        );
      }
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
