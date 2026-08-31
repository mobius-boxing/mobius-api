import {
  codeText,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { PAPER_CLASS_LABELS, PAPER_CLASS_LIMITS } from "./PaperClassCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class PaperClassUpdateInputDTO {
  code?: string;
  name?: string;
  /** See the create DTO. */
  papers?: unknown;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined)
      this.code = source.code as string;
    if (source.name !== undefined)
      this.name = source.name as string;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, PAPER_CLASS_LIMITS.code, PAPER_CLASS_LABELS.code),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, PAPER_CLASS_LIMITS.name, PAPER_CLASS_LABELS.name),
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
