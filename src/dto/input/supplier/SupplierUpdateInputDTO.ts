import { codeText, toBoolean } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { SUPPLIER_LABELS, SUPPLIER_LIMITS } from "./SupplierCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are validated with the create rules: blanking
 * `code` must fail here rather than as a NOT NULL violation whose knex message
 * carries the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class SupplierUpdateInputDTO {
  code?: string;
  suppliesSheets?: boolean;
  suppliesElaborated?: boolean;
  suppliesConsumables?: boolean;
  suppliesPaper?: boolean;
  suppliesTooling?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) this.code = source.code as string;
    if (source.suppliesSheets !== undefined)
      this.suppliesSheets = source.suppliesSheets as boolean;
    if (source.suppliesElaborated !== undefined)
      this.suppliesElaborated = source.suppliesElaborated as boolean;
    if (source.suppliesConsumables !== undefined)
      this.suppliesConsumables = source.suppliesConsumables as boolean;
    if (source.suppliesPaper !== undefined)
      this.suppliesPaper = source.suppliesPaper as boolean;
    if (source.suppliesTooling !== undefined)
      this.suppliesTooling = source.suppliesTooling as boolean;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, SUPPLIER_LIMITS.code, SUPPLIER_LABELS.code),
        );
      }
      const flags = [
        "suppliesSheets",
        "suppliesElaborated",
        "suppliesConsumables",
        "suppliesPaper",
        "suppliesTooling",
      ] as const;
      for (const flag of flags) {
        if (this[flag] !== undefined) {
          this[flag] = field(flag, () =>
            toBoolean(this[flag], SUPPLIER_LABELS[flag]),
          );
        }
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
