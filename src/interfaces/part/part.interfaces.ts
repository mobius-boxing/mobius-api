/**
 * The four approval state machines (08-approvals.md). Single source — the
 * controller's dispatch, the router's permission-code mapping, and the DAO's
 * column map all derive from these constants; adding a fifth machine here
 * makes every consumer pick it up (or fail to compile).
 */
export const APPROVAL_MACHINES = [
  "dimensions",
  "technical",
  "sketch",
  "part",
] as const;
export type ApprovalMachine = (typeof APPROVAL_MACHINES)[number];

/** Bulk ops touch these three — NEVER sketch (Procusto quirk, 08 §bulk). */
export const BULK_APPROVAL_MACHINES: ApprovalMachine[] = [
  "dimensions",
  "technical",
  "part",
];

/** One approval state machine's snapshot (08-approvals.md pair semantics). */
export interface IApprovalState {
  approvedAt?: Date | null;
  approvedBy?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
}

export interface IPart {
  id?: number;
  uuid?: string;
  companyId?: number;

  code?: string | null;
  revision?: number;
  clientCode?: string | null;
  description?: string | null;

  boxLength?: number | null;
  boxWidth?: number | null;
  boxHeight?: number | null;
  externalLength?: number | null;
  externalWidth?: number | null;
  externalHeight?: number | null;

  sheetLength?: number | null;
  sheetWidth?: number | null;
  additionalSheetLength?: number | null;
  preferredWidth?: number | null;

  flap?: number | null;
  lowerFlap?: number | null;
  upperFlap?: number | null;
  flapOverlap?: number | null;

  corrugationScoreLines?: string | null;
  printScoreLines?: string | null;
  symmetricScoreLines?: boolean;

  colorCount?: number | null;
  printSides?: number | null;
  inks?: string | null;
  labelsPerPallet?: number | null;
  labelText?: string | null;

  printCode?: boolean;
  printDate?: boolean;
  printRecyclable?: boolean;
  printWarranty?: boolean;
  printLogo?: boolean;
  printNationalIndustry?: boolean;
  printExport?: boolean;

  compressionTest?: number | null;
  burstTest?: number | null;
  cobbTest?: number | null;
  ect?: number | null;
  grammage?: number | null;

  lengthUpperTolerance?: number | null;
  lengthLowerTolerance?: number | null;
  widthUpperTolerance?: number | null;
  widthLowerTolerance?: number | null;
  overrunPercentage?: number | null;
  underrunPercentage?: number | null;
  corrugationOverproduction?: number | null;

  allowsRotation?: boolean;
  allowsPartialRotation?: boolean;
  mandatoryRotation?: boolean;

  boxSurface?: number | null;
  boxWeight?: number | null;
  averageWeight?: number | null;

  allowsGluing?: boolean;
  claspClosure?: string | null;

  associatedQuantity?: number | null;
  foodSafetyNumber?: string | null;
  blueprintRef?: string | null;
  notes?: string | null;
  quotingNotes?: string | null;

  dataSheetFileUuid?: string | null;
  sketchFileUuid?: string | null;
  blueprintFileUuid?: string | null;
  imageFileUuid?: string | null;

  productId?: number;
  corrugationId?: number;
  productionRouteId?: number;
  palletizationId?: number | null;
  modelId?: number | null;
  flapTypeId?: number | null;
  glueTypeId?: number | null;
  strappingTypeId?: number | null;
  traceTypeId?: number | null;
  complementId?: number | null;

  dimensionsApprovalAt?: Date | null;
  dimensionsApprovalBy?: string | null;
  dimensionsCancelledAt?: Date | null;
  dimensionsCancelledBy?: string | null;
  technicalApprovalAt?: Date | null;
  technicalApprovalBy?: string | null;
  technicalCancelledAt?: Date | null;
  technicalCancelledBy?: string | null;
  sketchApprovalAt?: Date | null;
  sketchApprovalBy?: string | null;
  sketchCancelledAt?: Date | null;
  sketchCancelledBy?: string | null;
  partApprovalAt?: Date | null;
  partApprovalBy?: string | null;
  partCancelledAt?: Date | null;
  partCancelledBy?: string | null;

  createdAt?: Date;
  createdBy?: string | null;
  registeredAt?: Date | null;
  updatedAt?: Date;
  legacyId?: number | null;

  // Transient (computed in the DAO projection — 01-entity.md)
  effectiveGrammage?: number | null;
  sheetSurface?: number | null;
  longDescription?: string;

  // Related entities (uuid-only nested objects)
  product?: { uuid: string; code?: string; description?: string | null; customer?: { uuid: string; name?: string } | null } | null;
  corrugation?: { uuid: string; code?: string; theoreticalGrammage?: number | null } | null;
  productionRoute?: { uuid: string; name?: string; isGlobal?: boolean } | null;
  palletization?: { uuid: string; code?: string | null; name?: string | null } | null;
  flapType?: { uuid: string; code?: string } | null;
  glueType?: { uuid: string; code?: string } | null;
  strappingType?: { uuid: string; code?: string } | null;
  traceType?: { uuid: string; code?: string } | null;
  complement?: { uuid: string; code?: string } | null;
}
