import { optionalInt, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { WAREHOUSE_LABELS, WAREHOUSE_LIMITS } from "./WarehouseCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are validated with the create rules: blanking a
 * required one must fail here rather than as a NOT NULL violation whose knex
 * message carries the generated SQL.
 *
 * `gridRows`/`gridCols` are NOT rendered by `EditWarehouseModal` — resizing is
 * routed to `WarehouseGridEditorModal` (B7), which PUTs to this same endpoint
 * with the same 1..50 bound. They are validated here so the two doors into
 * those columns cannot disagree.
 *
 * `companyId` is carried through exactly as before this batch: the update path
 * has always accepted it from the body. Neither validating nor dropping it is
 * in B3's scope — see the batch report's follow-up note.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class WarehouseUpdateInputDTO {
  name?: string;
  gridRows?: number;
  gridCols?: number;
  companyId?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.name !== undefined) {
      this.name = source.name as string;
    }
    if (source.gridRows !== undefined) {
      this.gridRows = source.gridRows as number;
    }
    if (source.gridCols !== undefined) {
      this.gridCols = source.gridCols as number;
    }
    if (source.companyId !== undefined) {
      this.companyId =
        typeof source.companyId === "string"
          ? parseInt(source.companyId, 10)
          : (source.companyId as number);
    }
  }

  public build(): this {
    collect((field) => {
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, WAREHOUSE_LIMITS.name, WAREHOUSE_LABELS.name),
        );
      }
      if (this.gridRows !== undefined) {
        this.gridRows = field("gridRows", () =>
          optionalInt(
            this.gridRows,
            { min: WAREHOUSE_LIMITS.gridMin, max: WAREHOUSE_LIMITS.gridMax },
            WAREHOUSE_LABELS.gridRows,
          ),
        );
      }
      if (this.gridCols !== undefined) {
        this.gridCols = field("gridCols", () =>
          optionalInt(
            this.gridCols,
            { min: WAREHOUSE_LIMITS.gridMin, max: WAREHOUSE_LIMITS.gridMax },
            WAREHOUSE_LABELS.gridCols,
          ),
        );
      }
    });

    // `inputValidator` (@sundaysf/utils) rejects ANY own key holding
    // `undefined` ("Param gridRows is missing"), so an unset optional field
    // used to 400 a request the column would have accepted. Drop unset keys.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
