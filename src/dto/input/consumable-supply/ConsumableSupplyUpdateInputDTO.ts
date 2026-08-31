import {
  clearableText,
  codeText,
  optionalNumber,
  optionalUuid,
  requiredText,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { CONSUMABLE_SUPPLY_LABELS, CONSUMABLE_SUPPLY_LIMITS } from "./ConsumableSupplyCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ConsumableSupplyUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string | null;
  location?: string | null;
  expiry?: string | null;
  consumableTypeUuid?: string;
  manufacturerUuid?: string;
  supplierUuid?: string;
  colorUuid?: string;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined)
      this.code = source.code as string;
    if (source.name !== undefined)
      this.name = source.name as string;
    if (source.description !== undefined)
      this.description = source.description as string | null;
    if (source.location !== undefined)
      this.location = source.location as string | null;
    if (source.expiry !== undefined)
      this.expiry = source.expiry as string | null;
    if (source.consumableTypeUuid !== undefined)
      this.consumableTypeUuid = source.consumableTypeUuid as string;
    if (source.manufacturerUuid !== undefined)
      this.manufacturerUuid = source.manufacturerUuid as string;
    if (source.supplierUuid !== undefined)
      this.supplierUuid = source.supplierUuid as string;
    if (source.colorUuid !== undefined)
      this.colorUuid = source.colorUuid as string;
    if (source.minimumStock !== undefined)
      this.minimumStock = source.minimumStock as number;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, CONSUMABLE_SUPPLY_LIMITS.code, CONSUMABLE_SUPPLY_LABELS.code),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, CONSUMABLE_SUPPLY_LIMITS.name, CONSUMABLE_SUPPLY_LABELS.name),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(this.description, CONSUMABLE_SUPPLY_LIMITS.text, CONSUMABLE_SUPPLY_LABELS.description),
        );
      }
      if (this.location !== undefined) {
        this.location = field("location", () =>
          clearableText(this.location, CONSUMABLE_SUPPLY_LIMITS.text, CONSUMABLE_SUPPLY_LABELS.location),
        );
      }
      if (this.expiry !== undefined) {
        this.expiry = field("expiry", () =>
          clearableText(this.expiry, CONSUMABLE_SUPPLY_LIMITS.text, CONSUMABLE_SUPPLY_LABELS.expiry),
        );
      }
      if (this.consumableTypeUuid !== undefined) {
        this.consumableTypeUuid = field("consumableTypeUuid", () =>
          requiredUuid(this.consumableTypeUuid, CONSUMABLE_SUPPLY_LABELS.consumableTypeUuid),
        );
      }
      if (this.manufacturerUuid !== undefined) {
        this.manufacturerUuid = field("manufacturerUuid", () =>
          optionalUuid(this.manufacturerUuid, CONSUMABLE_SUPPLY_LABELS.manufacturerUuid),
        );
      }
      if (this.supplierUuid !== undefined) {
        this.supplierUuid = field("supplierUuid", () =>
          optionalUuid(this.supplierUuid, CONSUMABLE_SUPPLY_LABELS.supplierUuid),
        );
      }
      if (this.colorUuid !== undefined) {
        this.colorUuid = field("colorUuid", () =>
          optionalUuid(this.colorUuid, CONSUMABLE_SUPPLY_LABELS.colorUuid),
        );
      }
      if (this.minimumStock !== undefined) {
        this.minimumStock = field("minimumStock", () =>
          optionalNumber(this.minimumStock, CONSUMABLE_SUPPLY_LIMITS.minimumStock, CONSUMABLE_SUPPLY_LABELS.minimumStock),
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
