import {
  clearableText,
  optionalNumber,
  optionalUuid,
  optionalInt,
  requiredInt,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/consumableStock.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30):
 *   consumable_stock.warehouseId/consumableSupplyId integer NOT NULL (FK)
 *   consumable_stock.warehouseLocationId            integer NULL     (FK)
 *   consumable_stock.supplierId/manufacturerId      integer NULL     (FK)
 *   consumable_stock.quantity                       integer NOT NULL, default 0
 *   consumable_stock.price                          numeric(10,2) NULL
 *   consumable_stock.comments                       text    NULL
 *
 * FK values are still UUIDs here: this controller resolves them AFTER
 * `build()`, so the DTO validates uuid shape and the controller turns them into
 * ids. The opposite of the `paperStock`/`sheetStock` path — the convention is
 * per-controller, not global.
 *
 * `companyId` is NOT a DTO field — the controller injects it (L-009).
 */
export const CONSUMABLE_STOCK_LIMITS = {
  comments: 10000,
  /** numeric(10,2) */
  money: { min: 0, max: 99999999.99, decimals: 2 },
  /** plain integer column */
  quantity: { min: 0, max: 2147483647 },
};

export const CONSUMABLE_STOCK_LABELS = {
  warehouseUuid: "El dep\u00f3sito",
  consumableSupplyUuid: "El insumo",
  warehouseLocationUuid: "La ubicaci\u00f3n",
  supplierUuid: "El proveedor",
  manufacturerUuid: "El fabricante",
  quantity: "La cantidad",
  price: "El precio",
  comments: "Los comentarios",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ConsumableStockCreateInputDTO {
  warehouseUuid: string;
  consumableSupplyUuid: string;
  warehouseLocationUuid?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  quantity?: number;
  price?: number;
  comments?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.warehouseUuid = source.warehouseUuid as string;
    this.consumableSupplyUuid = source.consumableSupplyUuid as string;
    this.warehouseLocationUuid = source.warehouseLocationUuid as string;
    this.supplierUuid = source.supplierUuid as string;
    this.manufacturerUuid = source.manufacturerUuid as string;
    this.quantity = source.quantity as number | undefined;
    this.price = source.price as number;
    this.comments = source.comments as string | null;
  }

  public build(): this {
    collect((field) => {
      this.warehouseUuid = field("warehouseUuid", () =>
        requiredUuid(this.warehouseUuid, CONSUMABLE_STOCK_LABELS.warehouseUuid),
      );
      this.consumableSupplyUuid = field("consumableSupplyUuid", () =>
        requiredUuid(this.consumableSupplyUuid, CONSUMABLE_STOCK_LABELS.consumableSupplyUuid),
      );
      this.warehouseLocationUuid = field("warehouseLocationUuid", () =>
        optionalUuid(this.warehouseLocationUuid, CONSUMABLE_STOCK_LABELS.warehouseLocationUuid),
      );
      this.supplierUuid = field("supplierUuid", () =>
        optionalUuid(this.supplierUuid, CONSUMABLE_STOCK_LABELS.supplierUuid),
      );
      this.manufacturerUuid = field("manufacturerUuid", () =>
        optionalUuid(this.manufacturerUuid, CONSUMABLE_STOCK_LABELS.manufacturerUuid),
      );
      // NOT NULL but WITH a default of 0, so the server leaves it optional:
      // omitting it takes the default, as it did before this batch. The modal
      // marks it required and that stricter CLIENT rule stands — a stricter
      // API would be a contract change for non-form callers.
      this.quantity = field("quantity", () =>
        optionalInt(this.quantity, CONSUMABLE_STOCK_LIMITS.quantity, CONSUMABLE_STOCK_LABELS.quantity),
      );
      this.price = field("price", () =>
        optionalNumber(this.price, CONSUMABLE_STOCK_LIMITS.money, CONSUMABLE_STOCK_LABELS.price),
      );
      this.comments = field("comments", () =>
        clearableText(this.comments, CONSUMABLE_STOCK_LIMITS.comments, CONSUMABLE_STOCK_LABELS.comments),
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
