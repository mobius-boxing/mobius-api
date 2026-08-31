import { codeText, toBoolean } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/supplier.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30),
 * not from migrations (AMENDMENT A1):
 *   suppliers.code       varchar(100) NOT NULL, UNIQUE (code) — GLOBAL, not
 *                        `(companyId, code)`, so a 23505 here is cross-tenant.
 *   suppliers.supplies*  boolean NULL, default false (five of them)
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token after `buildCreateDTO` returns (L-009), so nothing here may strip it.
 *
 * BEHAVIOUR NOTE: the old constructor defaulted every flag to `false` with
 * `?? false`, which wrote an explicit `false` for a box the user never saw.
 * `toBoolean` leaves an absent flag `undefined` and `build()` drops it, so the
 * column default applies instead — same stored value, one less lie about what
 * the user chose, and it matches what the client now sends.
 *
 * The update DTO imports these so the two can never drift apart.
 */
export const SUPPLIER_LIMITS = {
  code: 100,
};

export const SUPPLIER_LABELS = {
  code: "El código",
  suppliesSheets: "Provee láminas",
  suppliesElaborated: "Provee elaborados",
  suppliesConsumables: "Provee insumos",
  suppliesPaper: "Provee papel",
  suppliesTooling: "Provee herramentales",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class SupplierCreateInputDTO {
  code: string;
  suppliesSheets?: boolean;
  suppliesElaborated?: boolean;
  suppliesConsumables?: boolean;
  suppliesPaper?: boolean;
  suppliesTooling?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.suppliesSheets = source.suppliesSheets as boolean | undefined;
    this.suppliesElaborated = source.suppliesElaborated as boolean | undefined;
    this.suppliesConsumables = source.suppliesConsumables as
      | boolean
      | undefined;
    this.suppliesPaper = source.suppliesPaper as boolean | undefined;
    this.suppliesTooling = source.suppliesTooling as boolean | undefined;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, SUPPLIER_LIMITS.code, SUPPLIER_LABELS.code),
      );
      this.suppliesSheets = field("suppliesSheets", () =>
        toBoolean(this.suppliesSheets, SUPPLIER_LABELS.suppliesSheets),
      );
      this.suppliesElaborated = field("suppliesElaborated", () =>
        toBoolean(this.suppliesElaborated, SUPPLIER_LABELS.suppliesElaborated),
      );
      this.suppliesConsumables = field("suppliesConsumables", () =>
        toBoolean(
          this.suppliesConsumables,
          SUPPLIER_LABELS.suppliesConsumables,
        ),
      );
      this.suppliesPaper = field("suppliesPaper", () =>
        toBoolean(this.suppliesPaper, SUPPLIER_LABELS.suppliesPaper),
      );
      this.suppliesTooling = field("suppliesTooling", () =>
        toBoolean(this.suppliesTooling, SUPPLIER_LABELS.suppliesTooling),
      );
    });

    // `inputValidator` rejects ANY own key holding `undefined` ("Param
    // suppliesPaper is missing"), so an unticked box used to 400 a request the
    // column would have accepted. Drop unset keys.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
