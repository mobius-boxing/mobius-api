import { ICustomer } from "../customer/customer.interfaces";
import { IProductType } from "../product-type/product-type.interfaces";
import { IBoxType } from "../box-type/box-type.interfaces";

/** `approvalStatus` vocabulary (I-7): derived, never persisted. */
export const PRODUCT_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "cancelled",
] as const;
export type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];

/** approved iff productApprovalAt set, cancelled iff productCancellationAt set, else pending (I-7). */
export function deriveProductApprovalStatus(
  p: Pick<IProduct, "productApprovalAt" | "productCancellationAt">,
): ProductApprovalStatus {
  if (p.productApprovalAt != null) return "approved";
  if (p.productCancellationAt != null) return "cancelled";
  return "pending";
}

/** Nested reference shape on the outward surface: uuid + a label field or two. */
export interface IProductRef {
  uuid: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  isGlobal?: boolean;
  theoreticalGrammage?: number | null;
}

export interface IProduct {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  clientCode?: string | null;
  description?: string | null;
  customerId?: number;
  revision?: number;
  vip?: boolean;
  productTypeId?: number | null;
  boxTypeId?: number | null;
  // File refs (Ficha/Plano/Boceto/Imagen → files.uuid)
  technicalSheetFileUuid?: string | null;
  blueprintFileUuid?: string | null;
  sketchFileUuid?: string | null;
  imageFileUuid?: string | null;
  // Approval pair (AprobacionProducto/CancelacionProducto; user = username snapshot)
  productApprovalAt?: Date | null;
  productApprovalBy?: string | null;
  productCancellationAt?: Date | null;
  productCancellationBy?: string | null;

  // ── Folded production recipe (65 columns, model.md §Persistence) ─────────
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

  registeredAt?: Date | null;

  corrugationId?: number | null;
  productionRouteId?: number | null;
  palletizationId?: number | null;
  modelId?: number | null;
  flapTypeId?: number | null;
  glueTypeId?: number | null;
  strappingTypeId?: number | null;
  traceTypeId?: number | null;
  complementId?: number | null;
  partLegacyId?: number | null;

  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Computed on read (never persisted).
  approvalStatus?: ProductApprovalStatus;
  effectiveGrammage?: number | null;
  sheetSurface?: number | null;

  // Joined data (uuid-only nested objects)
  customer?: ICustomer;
  productType?: IProductType;
  boxType?: IBoxType;
  corrugation?: IProductRef | null;
  productionRoute?: IProductRef | null;
  palletization?: IProductRef | null;
  model?: IProductRef | null;
  flapType?: IProductRef | null;
  glueType?: IProductRef | null;
  strappingType?: IProductRef | null;
  traceType?: IProductRef | null;
  complement?: IProductRef | null;
}
