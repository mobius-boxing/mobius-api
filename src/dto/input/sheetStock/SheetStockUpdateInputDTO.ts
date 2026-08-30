import {
  clearableText,
  optionalInt,
  optionalNumber,
  requiredInt,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { SHEET_STOCK_LABELS, SHEET_STOCK_LIMITS } from "./SheetStockCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class SheetStockUpdateInputDTO {
  warehouseId?: number;
  paperSheetId?: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  quantity?: number;
  price?: number;
  comments?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.warehouseId !== undefined)
      this.warehouseId = source.warehouseId as number;
    if (source.paperSheetId !== undefined)
      this.paperSheetId = source.paperSheetId as number;
    if (source.warehouseLocationId !== undefined)
      this.warehouseLocationId = source.warehouseLocationId as number;
    if (source.supplierId !== undefined)
      this.supplierId = source.supplierId as number;
    if (source.manufacturerId !== undefined)
      this.manufacturerId = source.manufacturerId as number;
    if (source.quantity !== undefined)
      this.quantity = source.quantity as number;
    if (source.price !== undefined)
      this.price = source.price as number;
    if (source.comments !== undefined)
      this.comments = source.comments as string | null;
  }

  public build(): this {
    collect((field) => {
      if (this.warehouseId !== undefined) {
        this.warehouseId = field("warehouseId", () =>
          requiredInt(this.warehouseId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.warehouseId),
        );
      }
      if (this.paperSheetId !== undefined) {
        this.paperSheetId = field("paperSheetId", () =>
          requiredInt(this.paperSheetId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.paperSheetId),
        );
      }
      if (this.warehouseLocationId !== undefined) {
        this.warehouseLocationId = field("warehouseLocationId", () =>
          optionalInt(
            this.warehouseLocationId,
            SHEET_STOCK_LIMITS.id,
            SHEET_STOCK_LABELS.warehouseLocationId,
          ),
        );
      }
      if (this.supplierId !== undefined) {
        this.supplierId = field("supplierId", () =>
          optionalInt(this.supplierId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.supplierId),
        );
      }
      if (this.manufacturerId !== undefined) {
        this.manufacturerId = field("manufacturerId", () =>
          optionalInt(this.manufacturerId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.manufacturerId),
        );
      }
      if (this.quantity !== undefined) {
        this.quantity = field("quantity", () =>
          requiredInt(this.quantity, SHEET_STOCK_LIMITS.quantity, SHEET_STOCK_LABELS.quantity),
        );
      }
      if (this.price !== undefined) {
        this.price = field("price", () =>
          optionalNumber(this.price, SHEET_STOCK_LIMITS.money, SHEET_STOCK_LABELS.price),
        );
      }
      if (this.comments !== undefined) {
        this.comments = field("comments", () =>
          clearableText(this.comments, SHEET_STOCK_LIMITS.comments, SHEET_STOCK_LABELS.comments),
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
