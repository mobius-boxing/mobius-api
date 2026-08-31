import {
  clearableText,
  optionalNumber,
  optionalUuid,
  requiredInt,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { CONSUMABLE_STOCK_LABELS, CONSUMABLE_STOCK_LIMITS } from "./ConsumableStockCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ConsumableStockUpdateInputDTO {
  warehouseUuid?: string;
  consumableSupplyUuid?: string;
  warehouseLocationUuid?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  quantity?: number;
  price?: number;
  comments?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.warehouseUuid !== undefined)
      this.warehouseUuid = source.warehouseUuid as string;
    if (source.consumableSupplyUuid !== undefined)
      this.consumableSupplyUuid = source.consumableSupplyUuid as string;
    if (source.warehouseLocationUuid !== undefined)
      this.warehouseLocationUuid = source.warehouseLocationUuid as string;
    if (source.supplierUuid !== undefined)
      this.supplierUuid = source.supplierUuid as string;
    if (source.manufacturerUuid !== undefined)
      this.manufacturerUuid = source.manufacturerUuid as string;
    if (source.quantity !== undefined)
      this.quantity = source.quantity as number;
    if (source.price !== undefined)
      this.price = source.price as number;
    if (source.comments !== undefined)
      this.comments = source.comments as string | null;
  }

  public build(): this {
    collect((field) => {
      if (this.warehouseUuid !== undefined) {
        this.warehouseUuid = field("warehouseUuid", () =>
          requiredUuid(this.warehouseUuid, CONSUMABLE_STOCK_LABELS.warehouseUuid),
        );
      }
      if (this.consumableSupplyUuid !== undefined) {
        this.consumableSupplyUuid = field("consumableSupplyUuid", () =>
          requiredUuid(this.consumableSupplyUuid, CONSUMABLE_STOCK_LABELS.consumableSupplyUuid),
        );
      }
      if (this.warehouseLocationUuid !== undefined) {
        this.warehouseLocationUuid = field("warehouseLocationUuid", () =>
          optionalUuid(this.warehouseLocationUuid, CONSUMABLE_STOCK_LABELS.warehouseLocationUuid),
        );
      }
      if (this.supplierUuid !== undefined) {
        this.supplierUuid = field("supplierUuid", () =>
          optionalUuid(this.supplierUuid, CONSUMABLE_STOCK_LABELS.supplierUuid),
        );
      }
      if (this.manufacturerUuid !== undefined) {
        this.manufacturerUuid = field("manufacturerUuid", () =>
          optionalUuid(this.manufacturerUuid, CONSUMABLE_STOCK_LABELS.manufacturerUuid),
        );
      }
      if (this.quantity !== undefined) {
        this.quantity = field("quantity", () =>
          requiredInt(this.quantity, CONSUMABLE_STOCK_LIMITS.quantity, CONSUMABLE_STOCK_LABELS.quantity),
        );
      }
      if (this.price !== undefined) {
        this.price = field("price", () =>
          optionalNumber(this.price, CONSUMABLE_STOCK_LIMITS.money, CONSUMABLE_STOCK_LABELS.price),
        );
      }
      if (this.comments !== undefined) {
        this.comments = field("comments", () =>
          clearableText(this.comments, CONSUMABLE_STOCK_LIMITS.comments, CONSUMABLE_STOCK_LABELS.comments),
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
