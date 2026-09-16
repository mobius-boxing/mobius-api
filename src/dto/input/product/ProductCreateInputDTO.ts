import { SCORE_LINES_PATTERN } from "../../../services/score-lines/score-lines.helper";
import { toNumberInput, toIntInput } from "../../../utils/numbers";
import { FieldValidationError } from "../shared/ValidationError";

/**
 * Closed allow-list for the folded production recipe (D-1/D-2): the former
 * `dto/input/part/index.ts` key groups, minus what already lived on the
 * product (clientCode/description/revision/the four file refs) and minus
 * what is server-computed (boxWeight, I-6).
 */
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
  "averageWeight",
  "associatedQuantity",
] as const;

const INT_KEYS = ["colorCount", "labelsPerPallet"] as const;

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

/** FK references arrive as UUIDs; the controller resolves to internal ids. */
const REF_KEYS = [
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

/**
 * Stripped silently on both POST and PUT (C-12): computed, server-owned, or a
 * nested read-projection. Listed here so a GET body round-trips through PUT
 * without a 400 — every one of these is accepted-and-dropped, never rejected.
 */
export const READ_ONLY_KEYS = [
  "boxWeight",
  "approvalStatus",
  "effectiveGrammage",
  "sheetSurface",
  "partLegacyId",
  "uuid",
  "id",
  "createdAt",
  "updatedAt",
  "productApprovalAt",
  "productApprovalBy",
  "productCancellationAt",
  "productCancellationBy",
  "customer",
  "productType",
  "boxType",
  "corrugation",
  "productionRoute",
  "palletization",
  "model",
  "flapType",
  "glueType",
  "strappingType",
  "traceType",
  "complement",
] as const;

/**
 * D-18: one-release compatibility window for the legacy `initialPart` shape.
 * Merged into the flat body key-by-key (flat keys win), then discarded.
 * REMOVAL NOTE: delete this constant and the merge below in the release after
 * the new SPA ships flat bodies exclusively; retire the I-22 compat test with it.
 */
export const LEGACY_KEYS = ["initialPart"] as const;

type NumericKey = (typeof NUMERIC_KEYS)[number];
type IntKey = (typeof INT_KEYS)[number];
type BoolKey = (typeof BOOL_KEYS)[number];
type TextKey = (typeof TEXT_KEYS)[number];
type RefKey = (typeof REF_KEYS)[number];

/**
 * D-18: merge a legacy `initialPart` object into the flat body, flat keys
 * winning, then strip it. Shared by create and update so a PUT replaying a
 * legacy shape gets the same treatment.
 */
function mergeLegacyInitialPart(data: any): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(data ?? {}) };
  const legacy = body.initialPart;
  if (legacy && typeof legacy === "object") {
    for (const [key, value] of Object.entries(legacy)) {
      if (body[key] === undefined) body[key] = value;
    }
  }
  delete body.initialPart;
  return body;
}

/**
 * Closed allow-list DTO (no index signature — a dynamic assignment must go
 * through an explicit cast, and consumer typos fail to compile).
 */
class ProductBaseInputDTO implements Partial<
  Record<NumericKey | IntKey, number> &
    Record<BoolKey, boolean> &
    Record<TextKey, string> &
    Record<RefKey, string | null>
> {
  companyId?: number;
  code?: string;
  clientCode?: string;
  description?: string;
  customerId?: number;
  revision?: number;
  vip?: boolean;
  productTypeId?: number | null;
  boxTypeId?: number | null;
  technicalSheetFileUuid?: string | null;
  blueprintFileUuid?: string | null;
  sketchFileUuid?: string | null;
  imageFileUuid?: string | null;

  // Numeric (double precision)
  boxLength?: number;
  boxWidth?: number;
  boxHeight?: number;
  externalLength?: number;
  externalWidth?: number;
  externalHeight?: number;
  sheetLength?: number;
  sheetWidth?: number;
  additionalSheetLength?: number;
  preferredWidth?: number;
  flap?: number;
  lowerFlap?: number;
  upperFlap?: number;
  flapOverlap?: number;
  printSides?: number;
  compressionTest?: number;
  burstTest?: number;
  cobbTest?: number;
  ect?: number;
  grammage?: number;
  lengthUpperTolerance?: number;
  lengthLowerTolerance?: number;
  widthUpperTolerance?: number;
  widthLowerTolerance?: number;
  overrunPercentage?: number;
  underrunPercentage?: number;
  corrugationOverproduction?: number;
  boxSurface?: number;
  averageWeight?: number;
  associatedQuantity?: number;
  // Integer
  colorCount?: number;
  labelsPerPallet?: number;
  // Boolean
  symmetricScoreLines?: boolean;
  printCode?: boolean;
  printDate?: boolean;
  printRecyclable?: boolean;
  printWarranty?: boolean;
  printLogo?: boolean;
  printNationalIndustry?: boolean;
  printExport?: boolean;
  allowsRotation?: boolean;
  allowsPartialRotation?: boolean;
  mandatoryRotation?: boolean;
  allowsGluing?: boolean;
  // Text
  corrugationScoreLines?: string;
  printScoreLines?: string;
  inks?: string;
  labelText?: string;
  claspClosure?: string;
  foodSafetyNumber?: string;
  blueprintRef?: string;
  notes?: string;
  quotingNotes?: string;
  // FK refs (UUIDs)
  corrugationUuid?: string | null;
  productionRouteUuid?: string | null;
  palletizationUuid?: string | null;
  modelUuid?: string | null;
  flapTypeUuid?: string | null;
  glueTypeUuid?: string | null;
  strappingTypeUuid?: string | null;
  traceTypeUuid?: string | null;
  complementUuid?: string | null;
  registeredAt?: string | null;

  constructor(rawData: any) {
    const data = mergeLegacyInitialPart(rawData);

    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : (data.companyId as number | undefined);
    if (data.code !== undefined) this.code = data.code as string;
    if (data.clientCode !== undefined)
      this.clientCode = data.clientCode as string;
    if (data.technicalSheetFileUuid !== undefined)
      this.technicalSheetFileUuid = data.technicalSheetFileUuid as
        | string
        | null;
    if (data.blueprintFileUuid !== undefined)
      this.blueprintFileUuid = data.blueprintFileUuid as string | null;
    if (data.sketchFileUuid !== undefined)
      this.sketchFileUuid = data.sketchFileUuid as string | null;
    if (data.imageFileUuid !== undefined)
      this.imageFileUuid = data.imageFileUuid as string | null;
    if (data.description !== undefined)
      this.description = data.description as string;
    if (data.customerId !== undefined)
      this.customerId =
        typeof data.customerId === "string"
          ? parseInt(data.customerId, 10)
          : (data.customerId as number);
    if (data.revision !== undefined)
      this.revision =
        typeof data.revision === "string"
          ? parseInt(data.revision, 10)
          : (data.revision as number);
    if (data.vip !== undefined) this.vip = data.vip as boolean;
    if (data.productTypeId !== undefined)
      this.productTypeId =
        data.productTypeId === null
          ? null
          : typeof data.productTypeId === "string"
            ? parseInt(data.productTypeId, 10)
            : (data.productTypeId as number);
    if (data.boxTypeId !== undefined)
      this.boxTypeId =
        data.boxTypeId === null
          ? null
          : typeof data.boxTypeId === "string"
            ? parseInt(data.boxTypeId, 10)
            : (data.boxTypeId as number);

    const self = this as Record<string, unknown>;
    for (const key of NUMERIC_KEYS) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
    for (const key of INT_KEYS) {
      const v = toIntInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
    for (const key of BOOL_KEYS)
      if (data[key] !== undefined) self[key] = data[key] === true;
    for (const key of TEXT_KEYS)
      if (data[key] !== undefined) self[key] = data[key];
    for (const key of REF_KEYS)
      if (data[key] !== undefined) self[key] = data[key];
    if (data.registeredAt !== undefined)
      this.registeredAt = (data.registeredAt as string) || null;
  }

  /** Shared V-rule checks (02-validation.md), sent-key aware. */
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
    if (
      this.additionalSheetLength !== undefined &&
      this.additionalSheetLength < 0
    )
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

export class ProductCreateInputDTO extends ProductBaseInputDTO {
  public build(): this {
    // C-9/D-14: nothing new is required — code + customerId only, same as today.
    if (!this.code) {
      throw new FieldValidationError("code", "code is required");
    }
    if (!this.customerId) {
      throw new FieldValidationError("customerId", "customerId is required");
    }
    // Sent-but-invalid production keys are still validated (model.md POST contract).
    if (this.sheetLength !== undefined && !(this.sheetLength > 0))
      throw new FieldValidationError(
        "sheetLength",
        "Sheet length must be positive",
      );
    if (this.sheetWidth !== undefined && !(this.sheetWidth > 0))
      throw new FieldValidationError(
        "sheetWidth",
        "Sheet width must be positive",
      );
    this.validateShared();
    return this;
  }
}

export { ProductBaseInputDTO };
