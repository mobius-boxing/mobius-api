import {
  clearableText,
  codeText,
  optionalNumber,
  optionalUuid,
  requiredText,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/consumableSupply.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   consumable_supplies.code         varchar(255)  NOT NULL
 *   consumable_supplies.name         varchar(255)  NOT NULL
 *   consumable_supplies.description  text          NULL
 *   consumable_supplies.location     text          NULL
 *   consumable_supplies.expiry       text          NULL  ← text, NOT date
 *   consumable_supplies.minimumStock numeric(14,4) NULL
 *   consumable_supplies.{consumableType,manufacturer,supplier,color}Id integer NULL (FK)
 *
 * FK values are UUIDs here — this controller resolves them after `build()`.
 *
 * REQUIRED-NESS CONFLICT on `consumableTypeUuid`, resolved the B2 way: the
 * column is NULLABLE but the modal has always marked the select required, so
 * the stricter client rule is mirrored here rather than widened. Follow-up
 * NOT NULL card, same as `delivery_zones.code`.
 *
 * `expiry` is validated as TEXT, deliberately. `requiredDate`/`optionalDate`
 * would be the obvious choice and is the wrong one: the column is `text` and
 * holds free-form values, so a date rule would reject rows that exist today and
 * silently rewrite the rest into ISO.
 *
 * `companyId` is NOT a DTO field — the controller injects it (L-009).
 */
export const CONSUMABLE_SUPPLY_LIMITS = {
  code: 255,
  name: 255,
  text: 10000,
  /** numeric(14,4) */
  minimumStock: { min: 0, max: 9999999999.9999, decimals: 4 },
};

export const CONSUMABLE_SUPPLY_LABELS = {
  code: "El c\u00f3digo",
  name: "El nombre",
  description: "La descripci\u00f3n",
  location: "La ubicaci\u00f3n",
  expiry: "El vencimiento",
  consumableTypeUuid: "El tipo de insumo",
  manufacturerUuid: "El fabricante",
  supplierUuid: "El proveedor",
  colorUuid: "El color",
  minimumStock: "El stock m\u00ednimo",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ConsumableSupplyCreateInputDTO {
  code: string;
  name: string;
  description?: string | null;
  location?: string | null;
  expiry?: string | null;
  consumableTypeUuid: string;
  manufacturerUuid?: string;
  supplierUuid?: string;
  colorUuid?: string;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string;
    this.description = source.description as string | null;
    this.location = source.location as string | null;
    this.expiry = source.expiry as string | null;
    this.consumableTypeUuid = source.consumableTypeUuid as string;
    this.manufacturerUuid = source.manufacturerUuid as string;
    this.supplierUuid = source.supplierUuid as string;
    this.colorUuid = source.colorUuid as string;
    this.minimumStock = source.minimumStock as number;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, CONSUMABLE_SUPPLY_LIMITS.code, CONSUMABLE_SUPPLY_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(this.name, CONSUMABLE_SUPPLY_LIMITS.name, CONSUMABLE_SUPPLY_LABELS.name),
      );
      this.description = field("description", () =>
        clearableText(this.description, CONSUMABLE_SUPPLY_LIMITS.text, CONSUMABLE_SUPPLY_LABELS.description),
      );
      this.location = field("location", () =>
        clearableText(this.location, CONSUMABLE_SUPPLY_LIMITS.text, CONSUMABLE_SUPPLY_LABELS.location),
      );
      this.expiry = field("expiry", () =>
        clearableText(this.expiry, CONSUMABLE_SUPPLY_LIMITS.text, CONSUMABLE_SUPPLY_LABELS.expiry),
      );
      this.consumableTypeUuid = field("consumableTypeUuid", () =>
        requiredUuid(this.consumableTypeUuid, CONSUMABLE_SUPPLY_LABELS.consumableTypeUuid),
      );
      this.manufacturerUuid = field("manufacturerUuid", () =>
        optionalUuid(this.manufacturerUuid, CONSUMABLE_SUPPLY_LABELS.manufacturerUuid),
      );
      this.supplierUuid = field("supplierUuid", () =>
        optionalUuid(this.supplierUuid, CONSUMABLE_SUPPLY_LABELS.supplierUuid),
      );
      this.colorUuid = field("colorUuid", () =>
        optionalUuid(this.colorUuid, CONSUMABLE_SUPPLY_LABELS.colorUuid),
      );
      this.minimumStock = field("minimumStock", () =>
        optionalNumber(this.minimumStock, CONSUMABLE_SUPPLY_LIMITS.minimumStock, CONSUMABLE_SUPPLY_LABELS.minimumStock),
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
