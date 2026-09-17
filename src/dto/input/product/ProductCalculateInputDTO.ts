import { CascadeField } from "../../../services/product-calculator/product-calculator.service";
import { toNumberInput } from "../../../utils/numbers";
import { FieldValidationError } from "../shared/ValidationError";

/** D-11/D-19 8 cascade fields + flap/mandatoryRotation/model (fefco-sheet-calculation). */
export const CALCULATE_FIELDS: readonly CascadeField[] = [
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "boxSurface",
  "grammage",
  "flap",
  "mandatoryRotation",
  "model",
] as const;

/** `field`s whose `value` is a boolean instead of a number|null. */
const BOOLEAN_FIELDS: readonly CascadeField[] = ["mandatoryRotation"];

/** The numeric context keys `values` may carry. */
const NUMERIC_VALUES_KEYS = [
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "boxSurface",
  "boxWeight",
  "grammage",
  "sheetLength",
  "sheetWidth",
  "additionalSheetLength",
  "flap",
  "lowerFlap",
  "upperFlap",
  "flapOverlap",
] as const;

/** The text (score-line) context keys `values` may carry. */
const TEXT_VALUES_KEYS = ["corrugationScoreLines", "printScoreLines"] as const;

/** The boolean context keys `values` may carry. */
const BOOLEAN_VALUES_KEYS = ["mandatoryRotation"] as const;

const VALUES_KEYS = [
  ...NUMERIC_VALUES_KEYS,
  ...TEXT_VALUES_KEYS,
  ...BOOLEAN_VALUES_KEYS,
] as const;
type ValuesKey = (typeof VALUES_KEYS)[number];

export type CalculateValues = {
  [K in (typeof NUMERIC_VALUES_KEYS)[number]]?: number | null;
} & {
  [K in (typeof TEXT_VALUES_KEYS)[number]]?: string | null;
} & {
  [K in (typeof BOOLEAN_VALUES_KEYS)[number]]?: boolean;
};

/**
 * `POST /product/calculate` — stateless, read-only (I-14). `inputValidator`
 * only rejects empty objects, so every shape rule lives in `build()` and
 * THROWS (CLAUDE.md validation rule).
 *
 * `modelUuid` is company-scoped by the controller (L-009) — absent/null
 * keeps today's flute-only cascade (AC-3).
 */
export class ProductCalculateInputDTO {
  corrugationUuid!: string;
  modelUuid: string | null = null;
  field!: CascadeField;
  value: number | boolean | null = null;
  values: CalculateValues = {};

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

    if (body.modelUuid !== undefined && body.modelUuid !== null) {
      if (typeof body.modelUuid !== "string") {
        throw new FieldValidationError(
          "modelUuid",
          "modelUuid must be a uuid or null",
        );
      }
      this.modelUuid = body.modelUuid;
    }

    if (!(CALCULATE_FIELDS as readonly string[]).includes(body.field)) {
      throw new FieldValidationError(
        "field",
        `field must be one of: ${CALCULATE_FIELDS.join(", ")}`,
      );
    }
    this.field = body.field;

    if (this.field === "model") {
      // The model select changed; `modelUuid` drives the cascade — value ignored.
      this.value = null;
    } else if ((BOOLEAN_FIELDS as readonly string[]).includes(this.field)) {
      if (!Object.prototype.hasOwnProperty.call(body, "value")) {
        throw new FieldValidationError("value", "value is required");
      }
      if (typeof body.value !== "boolean") {
        throw new FieldValidationError("value", "value must be a boolean");
      }
      this.value = body.value;
    } else {
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
    }

    if (
      body.values === undefined ||
      body.values === null ||
      typeof body.values !== "object" ||
      Array.isArray(body.values)
    ) {
      throw new FieldValidationError("values", "values is required");
    }
    const values: CalculateValues = {};
    for (const [key, raw] of Object.entries(body.values)) {
      if (!(VALUES_KEYS as readonly string[]).includes(key)) {
        throw new FieldValidationError(
          "values",
          `unknown key in values: ${key}`,
        );
      }
      const k = key as ValuesKey;
      if ((BOOLEAN_VALUES_KEYS as readonly string[]).includes(k)) {
        if (typeof raw !== "boolean") {
          throw new FieldValidationError(
            "values",
            `values.${key} must be a boolean`,
          );
        }
        (values as Record<string, unknown>)[k] = raw;
        continue;
      }
      if ((TEXT_VALUES_KEYS as readonly string[]).includes(k)) {
        if (raw === null || raw === undefined) {
          (values as Record<string, unknown>)[k] = null;
          continue;
        }
        if (typeof raw !== "string") {
          throw new FieldValidationError(
            "values",
            `values.${key} must be a string or null`,
          );
        }
        (values as Record<string, unknown>)[k] = raw;
        continue;
      }
      if (raw === null || raw === undefined) {
        (values as Record<string, unknown>)[k] = null;
        continue;
      }
      const parsed = toNumberInput(raw);
      if (parsed === undefined) {
        throw new FieldValidationError(
          "values",
          `values.${key} must be a number or null`,
        );
      }
      (values as Record<string, unknown>)[k] = parsed;
    }
    this.values = values;

    return this;
  }
}
