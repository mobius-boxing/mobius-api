import {
  clearableText,
  optionalNumber,
  optionalText,
  optionalUuid,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  FINISHED_GOOD_LABELS,
  FINISHED_GOOD_LIMITS,
} from "./FinishedGoodCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. A present `name` is still held to the create rule: blanking a NOT
 * NULL column must fail here rather than as a knex error carrying the SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class FinishedGoodUpdateInputDTO {
  code?: string | null;
  name?: string;
  description?: string | null;
  // SECURITY: accept UUIDs from the frontend, never numeric ids.
  supplierUuid?: string | null;
  manufacturerUuid?: string | null;
  minimumStock?: number | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.name !== undefined) this.name = source.name as string;
    if (source.code !== undefined) this.code = source.code as string | null;
    if (source.description !== undefined)
      this.description = source.description as string | null;
    if (source.supplierUuid !== undefined)
      this.supplierUuid = source.supplierUuid as string | null;
    if (source.manufacturerUuid !== undefined)
      this.manufacturerUuid = source.manufacturerUuid as string | null;
    if (source.minimumStock !== undefined)
      this.minimumStock = source.minimumStock as number | null;
  }

  public build(): this {
    collect((field) => {
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            FINISHED_GOOD_LIMITS.name,
            FINISHED_GOOD_LABELS.name,
          ),
        );
      }
      if (this.code !== undefined) {
        this.code = field("code", () =>
          optionalText(
            this.code,
            FINISHED_GOOD_LIMITS.code,
            FINISHED_GOOD_LABELS.code,
          ),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            FINISHED_GOOD_LIMITS.description,
            FINISHED_GOOD_LABELS.description,
          ),
        );
      }
      if (this.supplierUuid !== undefined && this.supplierUuid !== null) {
        this.supplierUuid = field("supplierUuid", () =>
          optionalUuid(this.supplierUuid, FINISHED_GOOD_LABELS.supplierUuid),
        );
      }
      if (
        this.manufacturerUuid !== undefined &&
        this.manufacturerUuid !== null
      ) {
        this.manufacturerUuid = field("manufacturerUuid", () =>
          optionalUuid(
            this.manufacturerUuid,
            FINISHED_GOOD_LABELS.manufacturerUuid,
          ),
        );
      }
      if (this.minimumStock !== undefined && this.minimumStock !== null) {
        this.minimumStock = field("minimumStock", () =>
          optionalNumber(
            this.minimumStock,
            FINISHED_GOOD_LIMITS.minimumStock,
            FINISHED_GOOD_LABELS.minimumStock,
          ),
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
