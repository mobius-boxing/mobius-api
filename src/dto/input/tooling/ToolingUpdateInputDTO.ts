import {
  clearableText,
  optionalInt,
  optionalText,
  optionalUuid,
  requiredText,
  requiredUuid,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { TOOLING_LABELS, TOOLING_LIMITS } from "./ToolingCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class ToolingUpdateInputDTO {
  name?: string;
  code?: string | null;
  description?: string | null;
  toolingTypeUuid?: string;
  manufacturerUuid?: string;
  supplierUuid?: string;
  minimumStock?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.name !== undefined)
      this.name = source.name as string;
    if (source.code !== undefined)
      this.code = source.code as string | null;
    if (source.description !== undefined)
      this.description = source.description as string | null;
    if (source.toolingTypeUuid !== undefined)
      this.toolingTypeUuid = source.toolingTypeUuid as string;
    if (source.manufacturerUuid !== undefined)
      this.manufacturerUuid = source.manufacturerUuid as string;
    if (source.supplierUuid !== undefined)
      this.supplierUuid = source.supplierUuid as string;
    if (source.minimumStock !== undefined)
      this.minimumStock = source.minimumStock as number;
  }

  public build(): this {
    collect((field) => {
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, TOOLING_LIMITS.name, TOOLING_LABELS.name),
        );
      }
      if (this.code !== undefined) {
        this.code = field("code", () =>
          optionalText(this.code, TOOLING_LIMITS.code, TOOLING_LABELS.code),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(this.description, TOOLING_LIMITS.description, TOOLING_LABELS.description),
        );
      }
      if (this.toolingTypeUuid !== undefined) {
        this.toolingTypeUuid = field("toolingTypeUuid", () =>
          requiredUuid(this.toolingTypeUuid, TOOLING_LABELS.toolingTypeUuid),
        );
      }
      if (this.manufacturerUuid !== undefined) {
        this.manufacturerUuid = field("manufacturerUuid", () =>
          optionalUuid(this.manufacturerUuid, TOOLING_LABELS.manufacturerUuid),
        );
      }
      if (this.supplierUuid !== undefined) {
        this.supplierUuid = field("supplierUuid", () =>
          optionalUuid(this.supplierUuid, TOOLING_LABELS.supplierUuid),
        );
      }
      if (this.minimumStock !== undefined) {
        this.minimumStock = field("minimumStock", () =>
          optionalInt(this.minimumStock, TOOLING_LIMITS.minimumStock, TOOLING_LABELS.minimumStock),
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
