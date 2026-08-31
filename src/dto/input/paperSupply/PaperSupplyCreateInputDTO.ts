import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  requiredInt,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/paperSupply.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   paper_supplies.code         varchar(100)  NOT NULL, UNIQUE ("companyId", code)
 *   paper_supplies.name         varchar(255)  NOT NULL
 *   paper_supplies.description  text          NULL
 *   paper_supplies.color        text          NULL
 *   paper_supplies.grammage     numeric(10,2) NULL
 *   paper_supplies.price        numeric(12,2) NULL  ← 12, not 10
 *   paper_supplies.minimumStock jsonb         NULL  ← see below
 *   paper_supplies.{manufacturer,supplier,paperType,fscType}Id integer NULL (FK)
 *
 * `price` is `numeric(12,2)`: 9999999999.99, two digits wider than every other
 * price in this batch. Copying the stock ceiling would reject amounts the
 * column stores.
 *
 * THE JSONB CASE. `minimumStock` is not a number — it is a two-key document,
 * `{ weightKg, diameterMm }`, that the MODAL composes from two separate inputs.
 * So this DTO validates the two members individually and reports them under
 * `minimumStock.weightKg` / `minimumStock.diameterMm`, which are the paths the
 * form can pin an error on. `null` is preserved for either member because the
 * modal writes `?? null` to mean "no minimum", and jsonb stores that null
 * meaningfully — collapsing it to `undefined` would drop the key and leave a
 * stale value behind.
 *
 * jsonb has no scale of its own, so neither member gets a `decimals` rule; both
 * are bounded at `>= 0` only.
 *
 * FK values are INTEGERS here — the controller resolves them from uuids before
 * `build()`.
 *
 * `companyId` IS a field here, unlike every other DTO in this sweep: this
 * controller resolves the caller's company to a numeric id and writes it onto
 * `req.body` (line ~132) BEFORE constructing the DTO, then reads it back off
 * the built object. It is always present by then, so `requiredInt` is safe —
 * and validating it is worth doing precisely because it arrives through the
 * body (L-009).
 *
 * NULL AND THE INTERFACE: `description` and `color` are nullable columns, but
 * `IPaperSupply` types them `string | undefined` with no null. The DTO keeps
 * `clearableText` (so an empty string still CLEARS the field, which
 * `optionalText` would silently turn into "leave unchanged") and then maps an
 * explicit null to undefined, which is exactly what the old DTO's
 * `description?: string` could express. Widening the interface to accept null
 * is a separate change with its own blast radius.
 */
export const PAPER_SUPPLY_LIMITS = {
  code: 100,
  name: 255,
  text: 10000,
  /** Resolved numeric ids, not uuids. */
  id: { min: 1, max: 2147483647 },
  /** numeric(10,2) */
  grammage: { min: 0, max: 99999999.99, decimals: 2 },
  /** numeric(12,2) — wider than every other price in this batch. */
  price: { min: 0, max: 9999999999.99, decimals: 2 },
  /** Inside a jsonb document: no scale to enforce. */
  minimumStockMember: { min: 0 },
};

export const PAPER_SUPPLY_LABELS = {
  companyId: "La empresa",
  code: "El código",
  name: "El nombre",
  description: "La descripción",
  color: "El color",
  manufacturerId: "El fabricante",
  supplierId: "El proveedor",
  paperTypeId: "El tipo de papel",
  fscTypeId: "El tipo FSC",
  grammage: "El gramaje",
  price: "El precio",
  minimumStockWeightKg: "El stock mínimo (kg)",
  minimumStockDiameterMm: "El stock mínimo (mm)",
};

export interface IPaperSupplyMinimumStock {
  weightKg?: number | null;
  diameterMm?: number | null;
}

/**
 * Validates the jsonb document's two members, preserving an explicit `null`
 * (which means "no minimum") and reporting each under its own field path.
 */
export function buildMinimumStock(
  value: IPaperSupplyMinimumStock | undefined,
  field: <V>(name: string, fn: () => V) => V,
  limits: { min: number },
  labels: { weightKg: string; diameterMm: string },
): IPaperSupplyMinimumStock | undefined {
  if (value === undefined || value === null) return undefined;
  return {
    weightKg:
      value.weightKg === null
        ? null
        : field("minimumStock.weightKg", () =>
            optionalNumber(value.weightKg, limits, labels.weightKg),
          ),
    diameterMm:
      value.diameterMm === null
        ? null
        : field("minimumStock.diameterMm", () =>
            optionalNumber(value.diameterMm, limits, labels.diameterMm),
          ),
  };
}

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class PaperSupplyCreateInputDTO {
  companyId: number;
  code: string;
  name: string;
  description?: string;
  color?: string;
  manufacturerId?: number;
  supplierId?: number;
  paperTypeId?: number;
  fscTypeId?: number;
  grammage?: number;
  price?: number;
  minimumStock?: IPaperSupplyMinimumStock;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.companyId = source.companyId as number;
    this.code = source.code as string;
    this.name = source.name as string;
    this.description = source.description as string | undefined;
    this.color = source.color as string | undefined;
    this.manufacturerId = source.manufacturerId as number | undefined;
    this.supplierId = source.supplierId as number | undefined;
    this.paperTypeId = source.paperTypeId as number | undefined;
    this.fscTypeId = source.fscTypeId as number | undefined;
    this.grammage = source.grammage as number | undefined;
    this.price = source.price as number | undefined;
    this.minimumStock = source.minimumStock as
      | IPaperSupplyMinimumStock
      | undefined;
  }

  public build(): this {
    collect((field) => {
      this.companyId = field("companyId", () =>
        requiredInt(
          this.companyId,
          PAPER_SUPPLY_LIMITS.id,
          PAPER_SUPPLY_LABELS.companyId,
        ),
      );
      this.code = field("code", () =>
        codeText(this.code, PAPER_SUPPLY_LIMITS.code, PAPER_SUPPLY_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(
          this.name,
          PAPER_SUPPLY_LIMITS.name,
          PAPER_SUPPLY_LABELS.name,
        ),
      );
      // `?? undefined`: see the header — the interface has no null.
      this.description =
        field("description", () =>
          clearableText(
            this.description,
            PAPER_SUPPLY_LIMITS.text,
            PAPER_SUPPLY_LABELS.description,
          ),
        ) ?? undefined;
      this.color =
        field("color", () =>
          clearableText(
            this.color,
            PAPER_SUPPLY_LIMITS.text,
            PAPER_SUPPLY_LABELS.color,
          ),
        ) ?? undefined;
      this.manufacturerId = field("manufacturerId", () =>
        optionalInt(
          this.manufacturerId,
          PAPER_SUPPLY_LIMITS.id,
          PAPER_SUPPLY_LABELS.manufacturerId,
        ),
      );
      this.supplierId = field("supplierId", () =>
        optionalInt(
          this.supplierId,
          PAPER_SUPPLY_LIMITS.id,
          PAPER_SUPPLY_LABELS.supplierId,
        ),
      );
      this.paperTypeId = field("paperTypeId", () =>
        optionalInt(
          this.paperTypeId,
          PAPER_SUPPLY_LIMITS.id,
          PAPER_SUPPLY_LABELS.paperTypeId,
        ),
      );
      this.fscTypeId = field("fscTypeId", () =>
        optionalInt(
          this.fscTypeId,
          PAPER_SUPPLY_LIMITS.id,
          PAPER_SUPPLY_LABELS.fscTypeId,
        ),
      );
      this.grammage = field("grammage", () =>
        optionalNumber(
          this.grammage,
          PAPER_SUPPLY_LIMITS.grammage,
          PAPER_SUPPLY_LABELS.grammage,
        ),
      );
      this.price = field("price", () =>
        optionalNumber(
          this.price,
          PAPER_SUPPLY_LIMITS.price,
          PAPER_SUPPLY_LABELS.price,
        ),
      );
      this.minimumStock = buildMinimumStock(
        this.minimumStock,
        field,
        PAPER_SUPPLY_LIMITS.minimumStockMember,
        {
          weightKg: PAPER_SUPPLY_LABELS.minimumStockWeightKg,
          diameterMm: PAPER_SUPPLY_LABELS.minimumStockDiameterMm,
        },
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
