import {
  clearableText,
  optionalInt,
  optionalText,
  optionalUuid,
  requiredText,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/tooling.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   toolings.name           varchar(255) NOT NULL
 *   toolings.code           varchar(400) NULL
 *   toolings.description    text         NULL
 *   toolings.toolingTypeId  integer      NOT NULL (FK)
 *   toolings.manufacturerId/supplierId integer NULL (FK)
 *   toolings.minimumStock   integer      NULL, default 0
 *
 * FK values are UUIDs here — this controller resolves them after `build()`.
 *
 * `code` is nullable AND ruleless in the modal, so it genuinely stays optional
 * — no conflict to resolve, unlike `palletType` and `color`. It uses
 * `optionalText` rather than `codeText`: no unique index, no character rule has
 * ever applied.
 *
 * `companyId` is NOT a DTO field — the controller injects it (L-009).
 */
export const TOOLING_LIMITS = {
  name: 255,
  code: 400,
  description: 10000,
  /** plain integer with a default */
  minimumStock: { min: 0, max: 2147483647 },
};

export const TOOLING_LABELS = {
  name: "El nombre",
  code: "El c\u00f3digo",
  description: "La descripci\u00f3n",
  toolingTypeUuid: "El tipo de herramental",
  manufacturerUuid: "El fabricante",
  supplierUuid: "El proveedor",
  minimumStock: "El stock m\u00ednimo",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ToolingCreateInputDTO {
  name: string;
  code?: string | null;
  description?: string | null;
  toolingTypeUuid: string;
  manufacturerUuid?: string;
  supplierUuid?: string;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.code = source.code as string | null;
    this.description = source.description as string | null;
    this.toolingTypeUuid = source.toolingTypeUuid as string;
    this.manufacturerUuid = source.manufacturerUuid as string;
    this.supplierUuid = source.supplierUuid as string;
    this.minimumStock = source.minimumStock as number;
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () =>
        requiredText(this.name, TOOLING_LIMITS.name, TOOLING_LABELS.name),
      );
      this.code = field("code", () =>
        optionalText(this.code, TOOLING_LIMITS.code, TOOLING_LABELS.code),
      );
      this.description = field("description", () =>
        clearableText(this.description, TOOLING_LIMITS.description, TOOLING_LABELS.description),
      );
      this.toolingTypeUuid = field("toolingTypeUuid", () =>
        requiredUuid(this.toolingTypeUuid, TOOLING_LABELS.toolingTypeUuid),
      );
      this.manufacturerUuid = field("manufacturerUuid", () =>
        optionalUuid(this.manufacturerUuid, TOOLING_LABELS.manufacturerUuid),
      );
      this.supplierUuid = field("supplierUuid", () =>
        optionalUuid(this.supplierUuid, TOOLING_LABELS.supplierUuid),
      );
      this.minimumStock = field("minimumStock", () =>
        optionalInt(this.minimumStock, TOOLING_LIMITS.minimumStock, TOOLING_LABELS.minimumStock),
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
