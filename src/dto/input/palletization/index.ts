import { toNumberInput, toIntInput } from "../../../utils/numbers";
import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/palletType.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30),
 * not from migrations (AMENDMENT A1):
 *   pallet_types.code        varchar(400) NULL, UNIQUE ("companyId", code)
 *   pallet_types.description text         NULL
 *   pallet_types.length/width/weight/height  double precision NULL
 *
 * SIGN-OFF: `code` is NULLABLE in the column but REQUIRED here, mirroring the
 * client rule the modal has always enforced (same call as `delivery_zones.code`
 * in B2). A follow-up card adds NOT NULL.
 *
 * THE FLOAT DETAIL (L-010): the four measures are `double precision`, NOT
 * `numeric(p,s)`. Procusto parity keeps float columns float, so there is no
 * scale to enforce — passing `decimals` here would invent a constraint the
 * database does not have and reject values Procusto accepts. `min: 0` is the
 * only bound, which is what the old `validateNumerics()` checked too, except
 * it threw a bare `Error` (a 500 with no field) instead of a field-level 400.
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token (L-009).
 */
export const PALLET_TYPE_LIMITS = {
  code: 400,
  description: 10000,
  /** No `max`/`decimals`: `double precision` has neither. */
  measure: { min: 0 },
};

export const PALLET_TYPE_LABELS = {
  code: "El c\u00f3digo",
  description: "La descripci\u00f3n",
  length: "El largo",
  width: "El ancho",
  weight: "El peso",
  height: "El alto",
};

const PALLET_TYPE_NUMERIC = ["length", "width", "weight", "height"] as const;

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class PalletTypeCreateInputDTO {
  code?: string;
  description?: string | null;
  length?: number;
  width?: number;
  weight?: number;
  height?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string | undefined;
    this.description = source.description as string | null | undefined;
    const self = this as Record<string, unknown>;
    for (const key of PALLET_TYPE_NUMERIC) {
      self[key] = source[key];
    }
  }

  protected validate(required: boolean): void {
    collect((field) => {
      if (required || this.code !== undefined) {
        this.code = field("code", () =>
          codeText(this.code, PALLET_TYPE_LIMITS.code, PALLET_TYPE_LABELS.code),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            PALLET_TYPE_LIMITS.description,
            PALLET_TYPE_LABELS.description,
          ),
        );
      }
      const self = this as Record<string, unknown>;
      for (const key of PALLET_TYPE_NUMERIC) {
        if (self[key] === undefined) continue;
        self[key] = field(key, () =>
          optionalNumber(
            self[key],
            PALLET_TYPE_LIMITS.measure,
            PALLET_TYPE_LABELS[key],
          ),
        );
      }
    });
  }

  public build(): this {
    this.validate(true);
    // `inputValidator` rejects ANY own key holding `undefined`, so a blank
    // optional measure used to 400 a request the nullable column would accept.
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

/**
 * Only the fields the request carried are validated, and unset keys are
 * stripped — a partial update never blanks a column it did not mention. A
 * present `code` is still held to the create rule.
 */
export class PalletTypeUpdateInputDTO extends PalletTypeCreateInputDTO {
  public build(): this {
    this.validate(false);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

const PALLETIZATION_INT = [
  "boxesPerPackage",
  "packagesPerLevel",
  "levelsPerPallet",
  "additionalPackages",
  "sheetsPerPallet",
] as const;
const PALLETIZATION_NUMERIC = ["maxPalletHeight", "surface"] as const;

/**
 * From `palletizations_nonneg_chk` and the live column types (2026-08-30).
 * `smallint` counts (32767 ceiling), and two measures that must be STRICTLY
 * positive — `Number.MIN_VALUE` is the smallest double above zero.
 */
export const PALLETIZATION_LIMITS = {
  name: 400,
  code: 400,
  description: 10000,
  /** smallint, and `>= 0` per the CHECK. */
  count: { min: 0, max: 32767 },
  /** `> 0` per the CHECK — a zero here is a 23514. */
  strictlyPositiveMeasure: { min: Number.MIN_VALUE },
};

export const PALLETIZATION_LABELS: Record<string, string> = {
  name: "El nombre",
  code: "El código",
  description: "La descripción",
  boxesPerPackage: "Las cajas por paquete",
  packagesPerLevel: "Los paquetes por nivel",
  levelsPerPallet: "Los niveles por pallet",
  additionalPackages: "Los paquetes adicionales",
  sheetsPerPallet: "Las láminas por pallet",
  maxPalletHeight: "La altura máxima del pallet",
  surface: "La superficie",
};

export class PalletizationCreateInputDTO {
  code?: string;
  name!: string;
  description?: string;
  boxesPerPackage?: number;
  packagesPerLevel?: number;
  levelsPerPallet?: number;
  additionalPackages?: number;
  sheetsPerPallet?: number;
  maxPalletHeight?: number;
  surface?: number;
  stackingType?: string;
  observations?: string;
  // SECURITY: file + lookup references arrive as UUIDs.
  technicalFileUuid?: string;
  imageFileUuid?: string;
  palletTypeUuid?: string;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.stackingType !== undefined) this.stackingType = data.stackingType;
    if (data.observations !== undefined) this.observations = data.observations;
    if (data.technicalFileUuid !== undefined) this.technicalFileUuid = data.technicalFileUuid;
    if (data.imageFileUuid !== undefined) this.imageFileUuid = data.imageFileUuid;
    if (data.palletTypeUuid !== undefined) this.palletTypeUuid = data.palletTypeUuid;
    const self = this as Record<string, unknown>;
    for (const key of PALLETIZATION_INT) {
      const v = toIntInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
    for (const key of PALLETIZATION_NUMERIC) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
  }

  protected validateNumerics(): void {
    // Superseded by `validate()` below; kept as a no-op call site would be
    // dead code, so the whole method is gone.
  }

  /**
   * `palletizations_nonneg_chk`, expressed exactly as the constraint reads:
   *
   *   boxesPerPackage >= 0 AND … AND
   *   (maxPalletHeight IS NULL OR maxPalletHeight > 0) AND
   *   (surface IS NULL OR surface > 0)
   *
   * The five counts allow zero; the two measures do NOT — a zero height is a
   * 23514, not a valid row. The old `v < 0` loop treated all seven the same and
   * let a zero height through to the constraint. The counts are also `smallint`
   * (32767), not `integer`.
   */
  protected validate(required: boolean): void {
    collect((field) => {
      if (required || this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            PALLETIZATION_LIMITS.name,
            PALLETIZATION_LABELS.name,
          ),
        );
      }
      const self = this as Record<string, unknown>;
      for (const key of PALLETIZATION_INT) {
        if (self[key] === undefined) continue;
        self[key] = field(key, () =>
          optionalInt(
            self[key],
            PALLETIZATION_LIMITS.count,
            PALLETIZATION_LABELS[key],
          ),
        );
      }
      for (const key of PALLETIZATION_NUMERIC) {
        if (self[key] === undefined) continue;
        self[key] = field(key, () =>
          optionalNumber(
            self[key],
            PALLETIZATION_LIMITS.strictlyPositiveMeasure,
            PALLETIZATION_LABELS[key],
          ),
        );
      }
    });
  }

  public build(): this {
    this.validate(true);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

export class PalletizationUpdateInputDTO extends PalletizationCreateInputDTO {
  public build(): this {
    this.validate(false);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
