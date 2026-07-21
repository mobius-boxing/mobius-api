import { SCORE_LINES_PATTERN } from "../../../services/score-lines/score-lines.helper";

const num = (v: any): number | undefined =>
  v === undefined || v === null || v === ""
    ? undefined
    : typeof v === "string"
      ? parseFloat(v)
      : v;

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
  "flapTypeUuid",
  "glueTypeUuid",
  "strappingTypeUuid",
  "traceTypeUuid",
  "complementUuid",
] as const;

class PartBaseInputDTO {
  [key: string]: any;

  constructor(data: any) {
    for (const key of NUMERIC_KEYS) if (num(data[key]) !== undefined) this[key] = num(data[key]);
    for (const key of INT_KEYS)
      if (data[key] !== undefined && data[key] !== null && data[key] !== "")
        this[key] = parseInt(String(data[key]), 10);
    for (const key of BOOL_KEYS) if (data[key] !== undefined) this[key] = data[key] === true;
    for (const key of TEXT_KEYS) if (data[key] !== undefined) this[key] = data[key];
    for (const key of FILE_KEYS) if (data[key] !== undefined) this[key] = data[key] || null;
    for (const key of REF_KEYS) if (data[key] !== undefined) this[key] = data[key];
    if (data.registeredAt !== undefined) this.registeredAt = data.registeredAt || null;
  }

  /** Shared V-rule checks (02-validation.md). Throws on critical violations. */
  protected validateShared(): void {
    if (this.sheetLength !== undefined && !(this.sheetLength > 0))
      throw new Error("Sheet length must be positive"); // V4
    if (this.sheetWidth !== undefined && !(this.sheetWidth > 0))
      throw new Error("Sheet width must be positive"); // V5
    if (this.additionalSheetLength !== undefined && this.additionalSheetLength < 0)
      throw new Error("Additional sheet length must be non-negative"); // V6
    for (const key of ["corrugationScoreLines", "printScoreLines"] as const) {
      if (this[key] != null && this[key] !== "" && !SCORE_LINES_PATTERN.test(this[key]))
        throw new Error("Score lines may only contain digits, separators and spaces");
    }
  }
}

export class PartCreateInputDTO extends PartBaseInputDTO {
  public build(): this {
    // V2/V3-analog: corrugation required; route optional (RUTA PROPIA
    // auto-creation covers V3); product required (Partes.Producto_Id NOT NULL).
    if (!this.productUuid) throw new Error("productUuid is required");
    if (!this.corrugationUuid) throw new Error("Corrugation is required");
    if (!(this.sheetLength > 0)) throw new Error("Sheet length must be positive");
    if (!(this.sheetWidth > 0)) throw new Error("Sheet width must be positive");
    this.validateShared();
    return this;
  }
}

export class PartUpdateInputDTO extends PartBaseInputDTO {
  public build(): this {
    this.validateShared();
    Object.keys(this).forEach((key) => {
      if (this[key] === undefined) delete this[key];
    });
    return this;
  }
}

export class PartCascadeInputDTO {
  field: string;
  value: number | null;

  constructor(data: any) {
    this.field = data.field;
    this.value = data.value === null || data.value === "" ? null : num(data.value) ?? null;
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
      throw new Error(`Cascade field must be one of: ${allowed.join(", ")}`);
    return this;
  }
}
