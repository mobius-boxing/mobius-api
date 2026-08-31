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
 * Server mirror of `mobius-web-app/src/validation/schemas/toolingStock.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30):
 *   tooling_stock.warehouseId/toolingId   integer NOT NULL (FK)
 *   tooling_stock.warehouseLocationId     integer NULL     (FK)
 *   tooling_stock.supplierId/manufacturerId integer NULL   (FK)
 *   tooling_stock.quantity                integer NOT NULL, default 0
 *   tooling_stock.price                   numeric(10,2) NULL
 *   tooling_stock.comments                text    NULL
 *
 * FK values are still UUIDs here: this controller resolves them AFTER
 * `build()`, so the DTO validates uuid shape and the controller turns them into
 * ids. The opposite of the `paperStock`/`sheetStock` path — the convention is
 * per-controller, not global.
 *
 * `companyId` is NOT a DTO field — the controller injects it (L-009).
 */
export const TOOLING_STOCK_LIMITS = {
  comments: 10000,
  /** numeric(10,2) */
  money: { min: 0, max: 99999999.99, decimals: 2 },
  /** plain integer column */
  quantity: { min: 0, max: 2147483647 },
};

export const TOOLING_STOCK_LABELS = {
  warehouseUuid: "El dep\u00f3sito",
  toolingUuid: "El herramental",
  warehouseLocationUuid: "La ubicaci\u00f3n",
  supplierUuid: "El proveedor",
  manufacturerUuid: "El fabricante",
  quantity: "La cantidad",
  price: "El precio",
  comments: "Los comentarios",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ToolingStockCreateInputDTO {
  warehouseUuid: string;
  toolingUuid: string;
  warehouseLocationUuid?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  quantity?: number;
  price?: number;
  comments?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.warehouseUuid = source.warehouseUuid as string;
    this.toolingUuid = source.toolingUuid as string;
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
        requiredUuid(this.warehouseUuid, TOOLING_STOCK_LABELS.warehouseUuid),
      );
      this.toolingUuid = field("toolingUuid", () =>
        requiredUuid(this.toolingUuid, TOOLING_STOCK_LABELS.toolingUuid),
      );
      this.warehouseLocationUuid = field("warehouseLocationUuid", () =>
        optionalUuid(this.warehouseLocationUuid, TOOLING_STOCK_LABELS.warehouseLocationUuid),
      );
      this.supplierUuid = field("supplierUuid", () =>
        optionalUuid(this.supplierUuid, TOOLING_STOCK_LABELS.supplierUuid),
      );
      this.manufacturerUuid = field("manufacturerUuid", () =>
        optionalUuid(this.manufacturerUuid, TOOLING_STOCK_LABELS.manufacturerUuid),
      );
      // NOT NULL but WITH a default of 0, so the server leaves it optional:
      // omitting it takes the default, as it did before this batch. The modal
      // marks it required and that stricter CLIENT rule stands — a stricter
      // API would be a contract change for non-form callers.
      this.quantity = field("quantity", () =>
        optionalInt(this.quantity, TOOLING_STOCK_LIMITS.quantity, TOOLING_STOCK_LABELS.quantity),
      );
      this.price = field("price", () =>
        optionalNumber(this.price, TOOLING_STOCK_LIMITS.money, TOOLING_STOCK_LABELS.price),
      );
      this.comments = field("comments", () =>
        clearableText(this.comments, TOOLING_STOCK_LIMITS.comments, TOOLING_STOCK_LABELS.comments),
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
