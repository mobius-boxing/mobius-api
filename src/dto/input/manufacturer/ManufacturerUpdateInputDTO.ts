import { codeText, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  MANUFACTURER_LABELS,
  MANUFACTURER_LIMITS,
} from "./ManufacturerCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are validated with the create rules: blanking a
 * required one must fail here rather than as a NOT NULL violation whose knex
 * message carries the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ManufacturerUpdateInputDTO {
  code?: string;
  name?: string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) {
      this.code = source.code as string;
    }
    if (source.name !== undefined) {
      this.name = source.name as string;
    }
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(
            this.code,
            MANUFACTURER_LIMITS.code,
            MANUFACTURER_LABELS.code,
          ),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            MANUFACTURER_LIMITS.name,
            MANUFACTURER_LABELS.name,
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
