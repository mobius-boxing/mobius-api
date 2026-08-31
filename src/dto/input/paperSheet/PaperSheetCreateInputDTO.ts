import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/paperSheet.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   paper_sheets.code           varchar(255)  NOT NULL
 *   paper_sheets.name           varchar(255)  NOT NULL
 *   paper_sheets.description    text          NULL
 *   paper_sheets.supplierId/manufacturerId/corrugationId integer NULL (FK)
 *   paper_sheets.length/width   numeric(10,2) NULL
 *   paper_sheets.minimumStock   integer       NULL, default 0
 *
 * FK values are INTEGERS here: `PaperSheetController` resolves them from uuids
 * before constructing the DTO, so `optionalInt` is correct and `optionalUuid`
 * would reject every legitimate request.
 *
 * A fifth distinct `code` width (255). Per-table, never a shared constant.
 *
 * `minimumStock` is a plain `integer` on THIS table — `numeric(14,4)` on
 * consumable supplies and `jsonb` on paper supplies. One field name, three
 * types; the rule follows the column, not the name.
 *
 * `companyId` is NOT a DTO field — the controller injects it (L-009).
 */
export const PAPER_SHEET_LIMITS = {
  code: 255,
  name: 255,
  description: 10000,
  /** Resolved numeric ids, not uuids. */
  id: { min: 1, max: 2147483647 },
  /** numeric(10,2) */
  measure: { min: 0, max: 99999999.99, decimals: 2 },
  /** plain integer with a default */
  minimumStock: { min: 0, max: 2147483647 },
};

export const PAPER_SHEET_LABELS = {
  code: "El c\u00f3digo",
  name: "El nombre",
  description: "La descripci\u00f3n",
  supplierId: "El proveedor",
  manufacturerId: "El fabricante",
  corrugationId: "El corrugado",
  length: "El largo",
  width: "El ancho",
  minimumStock: "El stock m\u00ednimo",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class PaperSheetCreateInputDTO {
  code: string;
  name: string;
  description?: string | null;
  supplierId?: number;
  manufacturerId?: number;
  corrugationId?: number;
  length?: number;
  width?: number;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string;
    this.description = source.description as string | null;
    this.supplierId = source.supplierId as number;
    this.manufacturerId = source.manufacturerId as number;
    this.corrugationId = source.corrugationId as number;
    this.length = source.length as number;
    this.width = source.width as number;
    this.minimumStock = source.minimumStock as number;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, PAPER_SHEET_LIMITS.code, PAPER_SHEET_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(this.name, PAPER_SHEET_LIMITS.name, PAPER_SHEET_LABELS.name),
      );
      this.description = field("description", () =>
        clearableText(this.description, PAPER_SHEET_LIMITS.description, PAPER_SHEET_LABELS.description),
      );
      this.supplierId = field("supplierId", () =>
        optionalInt(this.supplierId, PAPER_SHEET_LIMITS.id, PAPER_SHEET_LABELS.supplierId),
      );
      this.manufacturerId = field("manufacturerId", () =>
        optionalInt(this.manufacturerId, PAPER_SHEET_LIMITS.id, PAPER_SHEET_LABELS.manufacturerId),
      );
      this.corrugationId = field("corrugationId", () =>
        optionalInt(this.corrugationId, PAPER_SHEET_LIMITS.id, PAPER_SHEET_LABELS.corrugationId),
      );
      this.length = field("length", () =>
        optionalNumber(this.length, PAPER_SHEET_LIMITS.measure, PAPER_SHEET_LABELS.length),
      );
      this.width = field("width", () =>
        optionalNumber(this.width, PAPER_SHEET_LIMITS.measure, PAPER_SHEET_LABELS.width),
      );
      this.minimumStock = field("minimumStock", () =>
        optionalInt(this.minimumStock, PAPER_SHEET_LIMITS.minimumStock, PAPER_SHEET_LABELS.minimumStock),
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
