import {
  clearableText,
  optionalNumber,
  optionalText,
  optionalUuid,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/finishedGood.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30),
 * not from migrations (AMENDMENT A1):
 *   finished_goods.code           varchar(400)  NULL
 *   finished_goods.name           varchar(400)  NOT NULL
 *   finished_goods.description    text          NULL
 *   finished_goods.supplierId     integer       NULL (FK; DTO takes the uuid)
 *   finished_goods.manufacturerId integer       NULL (FK; DTO takes the uuid)
 *   finished_goods.minimumStock   numeric(14,4) NULL → max 9999999999.9999
 *
 * `code` is the rare no-conflict case: nullable column, ruleless form. It stays
 * optional on both sides — there is nothing to reconcile.
 *
 * `code` uses `optionalText`, NOT `codeText`: this column has no unique index
 * and the form has never constrained its characters, so applying the identifier
 * pattern here would reject codes that exist in live rows today.
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token (L-009).
 *
 * The update DTO imports these so the two can never drift apart.
 */
export const FINISHED_GOOD_LIMITS = {
  code: 400,
  name: 400,
  description: 10000,
  /** numeric(14,4) */
  minimumStock: { min: 0, max: 9999999999.9999, decimals: 4 },
};

export const FINISHED_GOOD_LABELS = {
  code: "El código",
  name: "El nombre",
  description: "La descripción",
  supplierUuid: "El proveedor",
  manufacturerUuid: "El fabricante",
  minimumStock: "El stock mínimo",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class FinishedGoodCreateInputDTO {
  code?: string | null;
  name: string;
  description?: string | null;
  // SECURITY: accept UUIDs from the frontend, never numeric ids.
  supplierUuid?: string;
  manufacturerUuid?: string;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.code = source.code as string | null | undefined;
    this.description = source.description as string | null | undefined;
    this.supplierUuid = source.supplierUuid as string | undefined;
    this.manufacturerUuid = source.manufacturerUuid as string | undefined;
    this.minimumStock = source.minimumStock as number | undefined;
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () =>
        requiredText(
          this.name,
          FINISHED_GOOD_LIMITS.name,
          FINISHED_GOOD_LABELS.name,
        ),
      );
      this.code = field("code", () =>
        optionalText(
          this.code,
          FINISHED_GOOD_LIMITS.code,
          FINISHED_GOOD_LABELS.code,
        ),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          FINISHED_GOOD_LIMITS.description,
          FINISHED_GOOD_LABELS.description,
        ),
      );
      this.supplierUuid = field("supplierUuid", () =>
        optionalUuid(this.supplierUuid, FINISHED_GOOD_LABELS.supplierUuid),
      );
      this.manufacturerUuid = field("manufacturerUuid", () =>
        optionalUuid(
          this.manufacturerUuid,
          FINISHED_GOOD_LABELS.manufacturerUuid,
        ),
      );
      this.minimumStock = field("minimumStock", () =>
        optionalNumber(
          this.minimumStock,
          FINISHED_GOOD_LIMITS.minimumStock,
          FINISHED_GOOD_LABELS.minimumStock,
        ),
      );
    });

    // `inputValidator` rejects ANY own key holding `undefined`, so a blank
    // optional field used to 400 a request the nullable column would accept.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
