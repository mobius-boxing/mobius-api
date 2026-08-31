import {
  clearableText,
  optionalInt,
  optionalNumber,
  requiredInt,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { PAPER_STOCK_LABELS, PAPER_STOCK_LIMITS } from "./PaperStockCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class PaperStockUpdateInputDTO {
  warehouseId?: number;
  paperSupplyId?: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  comments?: string | null;
  price?: number;
  weight?: number;
  diameter?: number;
  width?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.warehouseId !== undefined)
      this.warehouseId = source.warehouseId as number;
    if (source.paperSupplyId !== undefined)
      this.paperSupplyId = source.paperSupplyId as number;
    if (source.warehouseLocationId !== undefined)
      this.warehouseLocationId = source.warehouseLocationId as number;
    if (source.supplierId !== undefined)
      this.supplierId = source.supplierId as number;
    if (source.manufacturerId !== undefined)
      this.manufacturerId = source.manufacturerId as number;
    if (source.comments !== undefined)
      this.comments = source.comments as string | null;
    if (source.price !== undefined)
      this.price = source.price as number;
    if (source.weight !== undefined)
      this.weight = source.weight as number;
    if (source.diameter !== undefined)
      this.diameter = source.diameter as number;
    if (source.width !== undefined)
      this.width = source.width as number;
  }

  public build(): this {
    collect((field) => {
      if (this.warehouseId !== undefined) {
        this.warehouseId = field("warehouseId", () =>
          requiredInt(this.warehouseId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.warehouseId),
        );
      }
      if (this.paperSupplyId !== undefined) {
        this.paperSupplyId = field("paperSupplyId", () =>
          requiredInt(this.paperSupplyId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.paperSupplyId),
        );
      }
      if (this.warehouseLocationId !== undefined) {
        this.warehouseLocationId = field("warehouseLocationId", () =>
          optionalInt(this.warehouseLocationId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.warehouseLocationId),
        );
      }
      if (this.supplierId !== undefined) {
        this.supplierId = field("supplierId", () =>
          optionalInt(this.supplierId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.supplierId),
        );
      }
      if (this.manufacturerId !== undefined) {
        this.manufacturerId = field("manufacturerId", () =>
          optionalInt(this.manufacturerId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.manufacturerId),
        );
      }
      if (this.comments !== undefined) {
        this.comments = field("comments", () =>
          clearableText(this.comments, PAPER_STOCK_LIMITS.comments, PAPER_STOCK_LABELS.comments),
        );
      }
      if (this.price !== undefined) {
        this.price = field("price", () =>
          optionalNumber(this.price, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.price),
        );
      }
      if (this.weight !== undefined) {
        this.weight = field("weight", () =>
          optionalNumber(this.weight, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.weight),
        );
      }
      if (this.diameter !== undefined) {
        this.diameter = field("diameter", () =>
          optionalNumber(this.diameter, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.diameter),
        );
      }
      if (this.width !== undefined) {
        this.width = field("width", () =>
          optionalNumber(this.width, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.width),
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
