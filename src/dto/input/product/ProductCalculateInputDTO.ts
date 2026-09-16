import { CascadeField } from "../../../services/product-calculator/product-calculator.service";
import { toNumberInput } from "../../../utils/numbers";
import { FieldValidationError } from "../shared/ValidationError";

/** D-11/D-19: today's 8 cascade fields only — CalcularPlancha etc are deferred. */
export const CALCULATE_FIELDS: readonly CascadeField[] = [
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "boxSurface",
  "grammage",
] as const;

/** The 9 calculable keys `values` may carry (the 8 cascade fields + boxWeight). */
const VALUES_KEYS = [
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "boxSurface",
  "boxWeight",
  "grammage",
] as const;
type ValuesKey = (typeof VALUES_KEYS)[number];

/**
 * `POST /product/calculate` — stateless, read-only (I-14). `inputValidator`
 * only rejects empty objects, so every shape rule lives in `build()` and
 * THROWS (CLAUDE.md validation rule).
 */
export class ProductCalculateInputDTO {
  corrugationUuid!: string;
  field!: CascadeField;
  value: number | null = null;
  values: Partial<Record<ValuesKey, number | null>> = {};

  private readonly raw: any;

  constructor(data: any) {
    this.raw = data ?? {};
  }

  public build(): this {
    const body = this.raw;

    if (!body.corrugationUuid || typeof body.corrugationUuid !== "string") {
      throw new FieldValidationError(
        "corrugationUuid",
        "corrugationUuid is required",
      );
    }
    this.corrugationUuid = body.corrugationUuid;

    if (!(CALCULATE_FIELDS as readonly string[]).includes(body.field)) {
      throw new FieldValidationError(
        "field",
        `field must be one of: ${CALCULATE_FIELDS.join(", ")}`,
      );
    }
    this.field = body.field;

    if (!Object.prototype.hasOwnProperty.call(body, "value")) {
      throw new FieldValidationError("value", "value is required");
    }
    if (body.value === null) {
      this.value = null;
    } else {
      const parsed = toNumberInput(body.value);
      if (parsed === undefined) {
        throw new FieldValidationError(
          "value",
          "value must be a number or null",
        );
      }
      this.value = parsed;
    }

    if (
      body.values === undefined ||
      body.values === null ||
      typeof body.values !== "object" ||
      Array.isArray(body.values)
    ) {
      throw new FieldValidationError("values", "values is required");
    }
    const values: Partial<Record<ValuesKey, number | null>> = {};
    for (const [key, raw] of Object.entries(body.values)) {
      if (!(VALUES_KEYS as readonly string[]).includes(key)) {
        throw new FieldValidationError(
          "values",
          `unknown key in values: ${key}`,
        );
      }
      if (raw === null || raw === undefined) {
        values[key as ValuesKey] = null;
        continue;
      }
      const parsed = toNumberInput(raw);
      if (parsed === undefined) {
        throw new FieldValidationError(
          "values",
          `values.${key} must be a number or null`,
        );
      }
      values[key as ValuesKey] = parsed;
    }
    this.values = values;

    return this;
  }
}
