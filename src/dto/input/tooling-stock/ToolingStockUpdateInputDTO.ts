import {
  clearableText,
  optionalNumber,
  optionalUuid,
  requiredInt,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { TOOLING_STOCK_LABELS, TOOLING_STOCK_LIMITS } from "./ToolingStockCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ToolingStockUpdateInputDTO {
  warehouseUuid?: string;
  toolingUuid?: string;
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
    if (source.toolingUuid !== undefined)
      this.toolingUuid = source.toolingUuid as string;
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
          requiredUuid(this.warehouseUuid, TOOLING_STOCK_LABELS.warehouseUuid),
        );
      }
      if (this.toolingUuid !== undefined) {
        this.toolingUuid = field("toolingUuid", () =>
          requiredUuid(this.toolingUuid, TOOLING_STOCK_LABELS.toolingUuid),
        );
      }
      if (this.warehouseLocationUuid !== undefined) {
        this.warehouseLocationUuid = field("warehouseLocationUuid", () =>
          optionalUuid(this.warehouseLocationUuid, TOOLING_STOCK_LABELS.warehouseLocationUuid),
        );
      }
      if (this.supplierUuid !== undefined) {
        this.supplierUuid = field("supplierUuid", () =>
          optionalUuid(this.supplierUuid, TOOLING_STOCK_LABELS.supplierUuid),
        );
      }
      if (this.manufacturerUuid !== undefined) {
        this.manufacturerUuid = field("manufacturerUuid", () =>
          optionalUuid(this.manufacturerUuid, TOOLING_STOCK_LABELS.manufacturerUuid),
        );
      }
      if (this.quantity !== undefined) {
        this.quantity = field("quantity", () =>
          requiredInt(this.quantity, TOOLING_STOCK_LIMITS.quantity, TOOLING_STOCK_LABELS.quantity),
        );
      }
      if (this.price !== undefined) {
        this.price = field("price", () =>
          optionalNumber(this.price, TOOLING_STOCK_LIMITS.money, TOOLING_STOCK_LABELS.price),
        );
      }
      if (this.comments !== undefined) {
        this.comments = field("comments", () =>
          clearableText(this.comments, TOOLING_STOCK_LIMITS.comments, TOOLING_STOCK_LABELS.comments),
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
