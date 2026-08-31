import {
  clearableText,
  optionalInt,
  optionalNumber,
  requiredInt,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/paperStock.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   paper_stock.warehouseId/paperSupplyId       integer NOT NULL (FK)
 *   paper_stock.warehouseLocationId/supplierId/manufacturerId integer NULL (FK)
 *   paper_stock.comments                        text    NULL
 *   paper_stock.price/weight/diameter/width     numeric(10,2) NULL
 *
 * FK VALUES ARE INTEGERS BY THE TIME THEY GET HERE, not uuids: the controller
 * calls `resolveForeignKeys(req.body)` BEFORE constructing this DTO, so the
 * uuid the client sent has already been swapped for the numeric id. That is why
 * these are `requiredInt`/`optionalInt` while the client schema validates
 * strings — the two sides mirror each other across a translation step, and
 * `requiredUuid` here would reject every legitimate request.
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token (L-009).
 */
export const PAPER_STOCK_LIMITS = {
  /** Resolved numeric ids, not uuids — see the header. */
  id: { min: 1, max: 2147483647 },
  comments: 10000,
  /** numeric(10,2) */
  money: { min: 0, max: 99999999.99, decimals: 2 },
};

export const PAPER_STOCK_LABELS = {
  warehouseId: "El dep\u00f3sito",
  paperSupplyId: "El insumo de papel",
  warehouseLocationId: "La ubicaci\u00f3n",
  supplierId: "El proveedor",
  manufacturerId: "El fabricante",
  comments: "Los comentarios",
  price: "El precio",
  weight: "El peso",
  diameter: "El di\u00e1metro",
  width: "El ancho",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class PaperStockCreateInputDTO {
  warehouseId: number;
  paperSupplyId: number;
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
    this.warehouseId = source.warehouseId as number;
    this.paperSupplyId = source.paperSupplyId as number;
    this.warehouseLocationId = source.warehouseLocationId as number;
    this.supplierId = source.supplierId as number;
    this.manufacturerId = source.manufacturerId as number;
    this.comments = source.comments as string | null;
    this.price = source.price as number;
    this.weight = source.weight as number;
    this.diameter = source.diameter as number;
    this.width = source.width as number;
  }

  public build(): this {
    collect((field) => {
      this.warehouseId = field("warehouseId", () =>
        requiredInt(this.warehouseId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.warehouseId),
      );
      this.paperSupplyId = field("paperSupplyId", () =>
        requiredInt(this.paperSupplyId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.paperSupplyId),
      );
      this.warehouseLocationId = field("warehouseLocationId", () =>
        optionalInt(this.warehouseLocationId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.warehouseLocationId),
      );
      this.supplierId = field("supplierId", () =>
        optionalInt(this.supplierId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.supplierId),
      );
      this.manufacturerId = field("manufacturerId", () =>
        optionalInt(this.manufacturerId, PAPER_STOCK_LIMITS.id, PAPER_STOCK_LABELS.manufacturerId),
      );
      this.comments = field("comments", () =>
        clearableText(this.comments, PAPER_STOCK_LIMITS.comments, PAPER_STOCK_LABELS.comments),
      );
      this.price = field("price", () =>
        optionalNumber(this.price, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.price),
      );
      this.weight = field("weight", () =>
        optionalNumber(this.weight, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.weight),
      );
      this.diameter = field("diameter", () =>
        optionalNumber(this.diameter, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.diameter),
      );
      this.width = field("width", () =>
        optionalNumber(this.width, PAPER_STOCK_LIMITS.money, PAPER_STOCK_LABELS.width),
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
