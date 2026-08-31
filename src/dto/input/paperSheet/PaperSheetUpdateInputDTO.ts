import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { PAPER_SHEET_LABELS, PAPER_SHEET_LIMITS } from "./PaperSheetCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class PaperSheetUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string | null;
  supplierId?: number;
  manufacturerId?: number;
  corrugationId?: number;
  length?: number;
  width?: number;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined)
      this.code = source.code as string;
    if (source.name !== undefined)
      this.name = source.name as string;
    if (source.description !== undefined)
      this.description = source.description as string | null;
    if (source.supplierId !== undefined)
      this.supplierId = source.supplierId as number;
    if (source.manufacturerId !== undefined)
      this.manufacturerId = source.manufacturerId as number;
    if (source.corrugationId !== undefined)
      this.corrugationId = source.corrugationId as number;
    if (source.length !== undefined)
      this.length = source.length as number;
    if (source.width !== undefined)
      this.width = source.width as number;
    if (source.minimumStock !== undefined)
      this.minimumStock = source.minimumStock as number;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, PAPER_SHEET_LIMITS.code, PAPER_SHEET_LABELS.code),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, PAPER_SHEET_LIMITS.name, PAPER_SHEET_LABELS.name),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(this.description, PAPER_SHEET_LIMITS.description, PAPER_SHEET_LABELS.description),
        );
      }
      if (this.supplierId !== undefined) {
        this.supplierId = field("supplierId", () =>
          optionalInt(this.supplierId, PAPER_SHEET_LIMITS.id, PAPER_SHEET_LABELS.supplierId),
        );
      }
      if (this.manufacturerId !== undefined) {
        this.manufacturerId = field("manufacturerId", () =>
          optionalInt(this.manufacturerId, PAPER_SHEET_LIMITS.id, PAPER_SHEET_LABELS.manufacturerId),
        );
      }
      if (this.corrugationId !== undefined) {
        this.corrugationId = field("corrugationId", () =>
          optionalInt(this.corrugationId, PAPER_SHEET_LIMITS.id, PAPER_SHEET_LABELS.corrugationId),
        );
      }
      if (this.length !== undefined) {
        this.length = field("length", () =>
          optionalNumber(this.length, PAPER_SHEET_LIMITS.measure, PAPER_SHEET_LABELS.length),
        );
      }
      if (this.width !== undefined) {
        this.width = field("width", () =>
          optionalNumber(this.width, PAPER_SHEET_LIMITS.measure, PAPER_SHEET_LABELS.width),
        );
      }
      if (this.minimumStock !== undefined) {
        this.minimumStock = field("minimumStock", () =>
          optionalInt(this.minimumStock, PAPER_SHEET_LIMITS.minimumStock, PAPER_SHEET_LABELS.minimumStock),
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
