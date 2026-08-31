import {
  clearableText,
  codeText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  TOOLING_TYPE_LABELS,
  TOOLING_TYPE_LIMITS,
} from "./ToolingTypeCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are validated with the create rules: blanking a
 * required one must fail here rather than as a NOT NULL violation whose knex
 * message carries the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ToolingTypeUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string | null;
  automaticConsumption?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) {
      this.code = source.code as string;
    }
    if (source.name !== undefined) {
      this.name = source.name as string;
    }
    if (source.description !== undefined) {
      this.description = source.description as string | null;
    }
    if (source.automaticConsumption !== undefined) {
      this.automaticConsumption = source.automaticConsumption as boolean;
    }
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(
            this.code,
            TOOLING_TYPE_LIMITS.code,
            TOOLING_TYPE_LABELS.code,
          ),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            TOOLING_TYPE_LIMITS.name,
            TOOLING_TYPE_LABELS.name,
          ),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            TOOLING_TYPE_LIMITS.description,
            TOOLING_TYPE_LABELS.description,
          ),
        );
      }
      if (this.automaticConsumption !== undefined) {
        this.automaticConsumption = field("automaticConsumption", () =>
          toBoolean(
            this.automaticConsumption,
            TOOLING_TYPE_LABELS.automaticConsumption,
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
