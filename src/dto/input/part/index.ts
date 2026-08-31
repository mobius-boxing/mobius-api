import { SCORE_LINES_PATTERN } from "../../../services/score-lines/score-lines.helper";
import { toNumberInput, toIntInput } from "../../../utils/numbers";
import { FieldValidationError } from "../shared/ValidationError";

const NUMERIC_KEYS = [
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "sheetLength",
  "sheetWidth",
  "additionalSheetLength",
  "preferredWidth",
  "flap",
  "lowerFlap",
  "upperFlap",
  "flapOverlap",
  "printSides",
  "compressionTest",
  "burstTest",
  "cobbTest",
  "ect",
  "grammage",
  "lengthUpperTolerance",
  "lengthLowerTolerance",
  "widthUpperTolerance",
  "widthLowerTolerance",
  "overrunPercentage",
  "underrunPercentage",
  "corrugationOverproduction",
  "boxSurface",
  "boxWeight",
  "averageWeight",
  "associatedQuantity",
] as const;

const INT_KEYS = ["revision", "colorCount", "labelsPerPallet"] as const;

const BOOL_KEYS = [
  "symmetricScoreLines",
  "printCode",
  "printDate",
  "printRecyclable",
  "printWarranty",
  "printLogo",
  "printNationalIndustry",
  "printExport",
  "allowsRotation",
  "allowsPartialRotation",
  "mandatoryRotation",
  "allowsGluing",
] as const;

const TEXT_KEYS = [
  "clientCode",
  "description",
  "corrugationScoreLines",
  "printScoreLines",
  "inks",
  "labelText",
  "claspClosure",
  "foodSafetyNumber",
  "blueprintRef",
  "notes",
  "quotingNotes",
] as const;

const FILE_KEYS = [
  "dataSheetFileUuid",
  "sketchFileUuid",
  "blueprintFileUuid",
  "imageFileUuid",
] as const;

// SECURITY: FK references arrive as UUIDs; the controller resolves to ids.
const REF_KEYS = [
  "productUuid",
  "corrugationUuid",
  "productionRouteUuid",
  "palletizationUuid",
  "modelUuid",
  "flapTypeUuid",
  "glueTypeUuid",
  "strappingTypeUuid",
  "traceTypeUuid",
  "complementUuid",
] as const;

type NumericKey = (typeof NUMERIC_KEYS)[number];
type IntKey = (typeof INT_KEYS)[number];
type BoolKey = (typeof BOOL_KEYS)[number];
type TextKey = (typeof TEXT_KEYS)[number];
type FileKey = (typeof FILE_KEYS)[number];
type RefKey = (typeof REF_KEYS)[number];

/**
 * Closed allow-list DTO (no index signature — a dynamic assignment must go
 * through an explicit cast, and consumer typos fail to compile).
 */
class PartBaseInputDTO
  implements
    Partial<
      Record<NumericKey | IntKey, number> &
        Record<BoolKey, boolean> &
        Record<TextKey | FileKey | RefKey, string | null>
    >
{
  // Numeric (double precision)
  boxLength?: number; boxWidth?: number; boxHeight?: number;
  externalLength?: number; externalWidth?: number; externalHeight?: number;
  sheetLength?: number; sheetWidth?: number; additionalSheetLength?: number;
  preferredWidth?: number; flap?: number; lowerFlap?: number; upperFlap?: number;
  flapOverlap?: number; printSides?: number; compressionTest?: number;
  burstTest?: number; cobbTest?: number; ect?: number; grammage?: number;
  lengthUpperTolerance?: number; lengthLowerTolerance?: number;
  widthUpperTolerance?: number; widthLowerTolerance?: number;
  overrunPercentage?: number; underrunPercentage?: number;
  corrugationOverproduction?: number; boxSurface?: number; boxWeight?: number;
  averageWeight?: number; associatedQuantity?: number;
  // Integer
  revision?: number; colorCount?: number; labelsPerPallet?: number;
  // Boolean
  symmetricScoreLines?: boolean; printCode?: boolean; printDate?: boolean;
  printRecyclable?: boolean; printWarranty?: boolean; printLogo?: boolean;
  printNationalIndustry?: boolean; printExport?: boolean;
  allowsRotation?: boolean; allowsPartialRotation?: boolean;
  mandatoryRotation?: boolean; allowsGluing?: boolean;
  // Text
  clientCode?: string; description?: string; corrugationScoreLines?: string;
  printScoreLines?: string; inks?: string; labelText?: string;
  claspClosure?: string; foodSafetyNumber?: string; blueprintRef?: string;
  notes?: string; quotingNotes?: string;
  // File refs
  dataSheetFileUuid?: string | null; sketchFileUuid?: string | null;
  blueprintFileUuid?: string | null; imageFileUuid?: string | null;
  // FK refs (UUIDs)
  productUuid?: string; corrugationUuid?: string; productionRouteUuid?: string;
  palletizationUuid?: string; modelUuid?: string; flapTypeUuid?: string;
  glueTypeUuid?: string;
  strappingTypeUuid?: string; traceTypeUuid?: string; complementUuid?: string;
  registeredAt?: string | null;

  constructor(data: any) {
    const self = this as Record<string, unknown>;
    for (const key of NUMERIC_KEYS) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
    for (const key of INT_KEYS) {
      const v = toIntInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
    for (const key of BOOL_KEYS) if (data[key] !== undefined) self[key] = data[key] === true;
    for (const key of TEXT_KEYS) if (data[key] !== undefined) self[key] = data[key];
    for (const key of FILE_KEYS) if (data[key] !== undefined) self[key] = data[key] || null;
    for (const key of REF_KEYS) if (data[key] !== undefined) self[key] = data[key];
    if (data.registeredAt !== undefined) this.registeredAt = data.registeredAt || null;
  }

  /** Shared V-rule checks (02-validation.md). Throws on critical violations. */
  protected validateShared(): void {
    if (this.sheetLength !== undefined && !(this.sheetLength > 0))
      throw new FieldValidationError(
        "sheetLength",
        "Sheet length must be positive",
      ); // V4
    if (this.sheetWidth !== undefined && !(this.sheetWidth > 0))
      throw new FieldValidationError(
        "sheetWidth",
        "Sheet width must be positive",
      ); // V5
    if (this.additionalSheetLength !== undefined && this.additionalSheetLength < 0)
      throw new FieldValidationError(
        "additionalSheetLength",
        "Additional sheet length must be non-negative",
      ); // V6
    for (const key of ["corrugationScoreLines", "printScoreLines"] as const) {
      const value = this[key];
      if (value != null && value !== "" && !SCORE_LINES_PATTERN.test(value))
        throw new FieldValidationError(
          key,
          "Score lines may only contain digits, separators and spaces",
        );
    }
  }
}

export class PartCreateInputDTO extends PartBaseInputDTO {
  public build(): this {
    // V2/V3-analog: corrugation required; route optional (RUTA PROPIA
    // auto-creation covers V3); product required (Partes.Producto_Id NOT NULL).
    if (!this.productUuid)
      throw new FieldValidationError(
        "productUuid",
        "productUuid is required",
      );
    if (!this.corrugationUuid)
      throw new FieldValidationError(
        "corrugationUuid",
        "Corrugation is required",
      );
    if (!(this.sheetLength !== undefined && this.sheetLength > 0))
      throw new FieldValidationError(
        "sheetLength",
        "Sheet length must be positive",
      );
    if (!(this.sheetWidth !== undefined && this.sheetWidth > 0))
      throw new FieldValidationError(
        "sheetWidth",
        "Sheet width must be positive",
      );
    this.validateShared();
    return this;
  }
}

export class PartUpdateInputDTO extends PartBaseInputDTO {
  public build(): this {
    this.validateShared();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

export class PartCascadeInputDTO {
  field: string;
  value: number | null;

  constructor(data: any) {
    this.field = data.field;
    this.value =
      data.value === null || data.value === ""
        ? null
        : (toNumberInput(data.value) ?? null);
  }

  public build(): this {
    const allowed = [
      "boxLength",
      "boxWidth",
      "boxHeight",
      "externalLength",
      "externalWidth",
      "externalHeight",
      "boxSurface",
      "grammage",
    ];
    if (!allowed.includes(this.field))
      throw new FieldValidationError(
        "field",
        `Cascade field must be one of: ${allowed.join(", ")}`,
      );
    return this;
  }
}
