import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  buildMinimumStock,
  IPaperSupplyMinimumStock,
  PAPER_SUPPLY_LABELS,
  PAPER_SUPPLY_LIMITS,
} from "./PaperSupplyCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. A present `code`/`name` is still held to the create rule.
 *
 * `minimumStock` is all-or-nothing, matching how the modal sends it: the two
 * members travel together inside one jsonb document, so a partial write would
 * drop whichever half was omitted.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class PaperSupplyUpdateInputDTO {
  code?: string;
  name?: string;
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
    if (source.code !== undefined) this.code = source.code as string;
    if (source.name !== undefined) this.name = source.name as string;
    if (source.description !== undefined)
      this.description = source.description as string;
    if (source.color !== undefined) this.color = source.color as string;
    if (source.manufacturerId !== undefined)
      this.manufacturerId = source.manufacturerId as number;
    if (source.supplierId !== undefined)
      this.supplierId = source.supplierId as number;
    if (source.paperTypeId !== undefined)
      this.paperTypeId = source.paperTypeId as number;
    if (source.fscTypeId !== undefined)
      this.fscTypeId = source.fscTypeId as number;
    if (source.grammage !== undefined)
      this.grammage = source.grammage as number;
    if (source.price !== undefined) this.price = source.price as number;
    if (source.minimumStock !== undefined)
      this.minimumStock = source.minimumStock as IPaperSupplyMinimumStock;
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(
            this.code,
            PAPER_SUPPLY_LIMITS.code,
            PAPER_SUPPLY_LABELS.code,
          ),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            PAPER_SUPPLY_LIMITS.name,
            PAPER_SUPPLY_LABELS.name,
          ),
        );
      }
      if (this.description !== undefined) {
        this.description =
          field("description", () =>
            clearableText(
              this.description,
              PAPER_SUPPLY_LIMITS.text,
              PAPER_SUPPLY_LABELS.description,
            ),
          ) ?? undefined;
      }
      if (this.color !== undefined) {
        this.color =
          field("color", () =>
            clearableText(
              this.color,
              PAPER_SUPPLY_LIMITS.text,
              PAPER_SUPPLY_LABELS.color,
            ),
          ) ?? undefined;
      }
      if (this.manufacturerId !== undefined) {
        this.manufacturerId = field("manufacturerId", () =>
          optionalInt(
            this.manufacturerId,
            PAPER_SUPPLY_LIMITS.id,
            PAPER_SUPPLY_LABELS.manufacturerId,
          ),
        );
      }
      if (this.supplierId !== undefined) {
        this.supplierId = field("supplierId", () =>
          optionalInt(
            this.supplierId,
            PAPER_SUPPLY_LIMITS.id,
            PAPER_SUPPLY_LABELS.supplierId,
          ),
        );
      }
      if (this.paperTypeId !== undefined) {
        this.paperTypeId = field("paperTypeId", () =>
          optionalInt(
            this.paperTypeId,
            PAPER_SUPPLY_LIMITS.id,
            PAPER_SUPPLY_LABELS.paperTypeId,
          ),
        );
      }
      if (this.fscTypeId !== undefined) {
        this.fscTypeId = field("fscTypeId", () =>
          optionalInt(
            this.fscTypeId,
            PAPER_SUPPLY_LIMITS.id,
            PAPER_SUPPLY_LABELS.fscTypeId,
          ),
        );
      }
      if (this.grammage !== undefined) {
        this.grammage = field("grammage", () =>
          optionalNumber(
            this.grammage,
            PAPER_SUPPLY_LIMITS.grammage,
            PAPER_SUPPLY_LABELS.grammage,
          ),
        );
      }
      if (this.price !== undefined) {
        this.price = field("price", () =>
          optionalNumber(
            this.price,
            PAPER_SUPPLY_LIMITS.price,
            PAPER_SUPPLY_LABELS.price,
          ),
        );
      }
      if (this.minimumStock !== undefined) {
        this.minimumStock = buildMinimumStock(
          this.minimumStock,
          field,
          PAPER_SUPPLY_LIMITS.minimumStockMember,
          {
            weightKg: PAPER_SUPPLY_LABELS.minimumStockWeightKg,
            diameterMm: PAPER_SUPPLY_LABELS.minimumStockDiameterMm,
          },
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
