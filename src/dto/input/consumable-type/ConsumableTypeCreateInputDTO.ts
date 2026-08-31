import { codeText, requiredText, toBoolean } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of
 * `mobius-web-app/src/validation/schemas/consumableType.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   consumable_types.code            varchar(255) NOT NULL, NO unique index
 *   consumable_types.name            varchar(255) NOT NULL
 *   consumable_types.autoConsumption boolean      NULL, default false
 *
 * `companyId` is NOT a DTO field — `BaseCrudController.create` injects it
 * from the caller's token after `buildCreateDTO` returns (L-009), so
 * nothing here may strip it.
 *
 * SIGN-OFF (2026-08-29): `code` is varchar(255) — a FOURTH distinct code width
 * (50 / 100 / 255 / 400) — but the form has always capped at 50 and the API
 * mirrors the FORM, not the column: the width is the ceiling, not the target.
 * The cap is stated here per-table, never as a shared constant.
 *
 * Also unique to this table: `code` has NO unique constraint at all, so a 23505
 * can never fire for it. That is pre-existing and untouched by this batch.
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const CONSUMABLE_TYPE_LIMITS = {
  /** The UI's long-standing cap; the column itself is varchar(255). */
  code: 50,
  name: 255,
};

export const CONSUMABLE_TYPE_LABELS = {
  code: "El código",
  name: "El nombre",
  autoConsumption: "El consumo automático",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ConsumableTypeCreateInputDTO {
  code: string;
  name: string;
  autoConsumption?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string;
    if (source.autoConsumption !== undefined) {
      this.autoConsumption = source.autoConsumption as boolean;
    }
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(
          this.code,
          CONSUMABLE_TYPE_LIMITS.code,
          CONSUMABLE_TYPE_LABELS.code,
        ),
      );
      this.name = field("name", () =>
        requiredText(
          this.name,
          CONSUMABLE_TYPE_LIMITS.name,
          CONSUMABLE_TYPE_LABELS.name,
        ),
      );
      if (this.autoConsumption !== undefined) {
        this.autoConsumption = field("autoConsumption", () =>
          toBoolean(
            this.autoConsumption,
            CONSUMABLE_TYPE_LABELS.autoConsumption,
          ),
        );
      }
    });

    // `inputValidator` (@sundaysf/utils) rejects ANY own key holding
    // `undefined` ("Param autoConsumption is missing"), so an unset optional
    // field used to 400 a request the column would have accepted. Drop unset
    // keys; the controller applies the column's `false` default afterwards.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
