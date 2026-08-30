import {
  clearableText,
  optionalInt,
  optionalNumber,
  requiredInt,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/sheetStock.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30):
 *   sheet_stock.warehouseId/paperSheetId  integer NOT NULL (FK)
 *   sheet_stock.supplierId/manufacturerId integer NULL     (FK)
 *   sheet_stock.quantity                  integer NOT NULL, default 0
 *   sheet_stock.price                     numeric(10,2) NULL
 *   sheet_stock.comments                  text    NULL
 *
 * FK VALUES ARE INTEGERS BY THE TIME THEY GET HERE, not uuids: the controller
 * calls `resolveForeignKeys(req.body)` BEFORE constructing this DTO, so the
 * uuid the client sent has already been swapped for the numeric id. That is why
 * these are `requiredInt`/`optionalInt` while the client schema validates
 * strings — the two sides mirror each other across a translation step, and
 * `requiredUuid` here would reject every legitimate request.
 *
 * `quantity` is required on both sides even though the column has a default:
 * the modal has always sent it, and the governing principle keeps the stricter
 * existing rule.
 *
 * `companyId` is NOT a DTO field — the controller injects it (L-009).
 */
export const SHEET_STOCK_LIMITS = {
  /** Resolved numeric ids, not uuids — see the header. */
  id: { min: 1, max: 2147483647 },
  comments: 10000,
  /** numeric(10,2) */
  money: { min: 0, max: 99999999.99, decimals: 2 },
  /** plain integer column */
  quantity: { min: 0, max: 2147483647 },
};

export const SHEET_STOCK_LABELS = {
  warehouseId: "El dep\u00f3sito",
  paperSheetId: "La l\u00e1mina",
  warehouseLocationId: "La ubicaci\u00f3n",
  supplierId: "El proveedor",
  manufacturerId: "El fabricante",
  quantity: "La cantidad",
  price: "El precio",
  comments: "Los comentarios",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class SheetStockCreateInputDTO {
  warehouseId: number;
  paperSheetId: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  quantity?: number;
  price?: number;
  comments?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.warehouseId = source.warehouseId as number;
    this.paperSheetId = source.paperSheetId as number;
    this.warehouseLocationId = source.warehouseLocationId as
      | number
      | undefined;
    this.supplierId = source.supplierId as number;
    this.manufacturerId = source.manufacturerId as number;
    this.quantity = source.quantity as number | undefined;
    this.price = source.price as number;
    this.comments = source.comments as string | null;
  }

  public build(): this {
    collect((field) => {
      this.warehouseId = field("warehouseId", () =>
        requiredInt(this.warehouseId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.warehouseId),
      );
      this.paperSheetId = field("paperSheetId", () =>
        requiredInt(this.paperSheetId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.paperSheetId),
      );
      this.warehouseLocationId = field("warehouseLocationId", () =>
        optionalInt(
          this.warehouseLocationId,
          SHEET_STOCK_LIMITS.id,
          SHEET_STOCK_LABELS.warehouseLocationId,
        ),
      );
      this.supplierId = field("supplierId", () =>
        optionalInt(this.supplierId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.supplierId),
      );
      this.manufacturerId = field("manufacturerId", () =>
        optionalInt(this.manufacturerId, SHEET_STOCK_LIMITS.id, SHEET_STOCK_LABELS.manufacturerId),
      );
      // NOT NULL but WITH a default of 0, so the server leaves it optional:
      // omitting it takes the default, as it did before this batch. The modal
      // marks it required and that stricter CLIENT rule stands — a stricter
      // API would be a contract change for non-form callers.
      this.quantity = field("quantity", () =>
        optionalInt(this.quantity, SHEET_STOCK_LIMITS.quantity, SHEET_STOCK_LABELS.quantity),
      );
      this.price = field("price", () =>
        optionalNumber(this.price, SHEET_STOCK_LIMITS.money, SHEET_STOCK_LABELS.price),
      );
      this.comments = field("comments", () =>
        clearableText(this.comments, SHEET_STOCK_LIMITS.comments, SHEET_STOCK_LABELS.comments),
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
