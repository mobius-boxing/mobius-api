/**
 * `corrugator_plans` + children — API surface (docs/dev/corrugator-planning/
 * model.md, PRIMARY, and its final "Amendments" section which overrides
 * earlier sections). Engine types (`CorrugatorParameters`, machine snapshot,
 * solve statuses, `CorrugatorSummary`) are re-exported from
 * `services/corrugator/types.ts` rather than redefined (T2 must not
 * duplicate the frozen engine contract).
 */
import {
  CorrugatorParameters,
  CORRUGATOR_PARAMETER_DEFAULTS,
  CorrugatorConstraintFlags,
  CorrugatorPriority,
  CorrugatorFulfillment,
  CorrugatorMachineSnapshot,
  CorrugatorSolveStatus,
  CORRUGATOR_SOLVE_STATUSES,
  CorrugatorSummary,
  machineKeyOf,
  engineMachines,
} from "../../services/corrugator/types";

export {
  CorrugatorParameters,
  CORRUGATOR_PARAMETER_DEFAULTS,
  CorrugatorConstraintFlags,
  CorrugatorPriority,
  CorrugatorFulfillment,
  CorrugatorMachineSnapshot,
  CorrugatorSolveStatus,
  CORRUGATOR_SOLVE_STATUSES,
  machineKeyOf,
  engineMachines,
};

export type ICorrugatorSummary = CorrugatorSummary;

export const CORRUGATOR_PLAN_STATUSES = [
  "draft",
  "solving",
  "solved",
  "failed",
  "registered",
] as const;
export type CorrugatorPlanStatus = (typeof CORRUGATOR_PLAN_STATUSES)[number];

/** P-1's two outcomes plus 'manual' — set whenever a line edits `sheetsPerUnit` directly. */
export type CorrugatorSheetsSource = "route" | "quantity" | "manual";

export const CORRUGATOR_NOT_PLANNABLE_REASONS = [
  "no-sheet-dimensions",
  "no-corrugation",
  "within-tolerance",
  "fully-allocated",
] as const;
export type CorrugatorNotPlannableReason =
  (typeof CORRUGATOR_NOT_PLANNABLE_REASONS)[number];

export interface ICorrugationRef {
  uuid: string;
  code: string;
}

export interface IPaperClassRef {
  code: string;
  name: string;
}

/** D-10 (+ Amendment C-2 grammage suffix): the board compatibility key. */
export interface CorrugatorBoard {
  key: string;
  corrugations: ICorrugationRef[];
  fluteTypes: string[];
  paperClasses: IPaperClassRef[];
  theoreticalGrammage: number | null;
}

/** One entry of the `machines` body param on POST/PUT (Amendment D-23). */
export interface ICorrugatorPlanMachineInput {
  machineUuid: string;
  widths?: number[];
}

export interface IProductionOrderRef {
  uuid: string;
  number: string;
}

export interface ICorrugatorPlanRef {
  uuid: string;
  number: number;
  status: CorrugatorPlanStatus;
  registeredAt?: Date | string | null;
}

export interface ICorrugatorPlanOrderRef {
  uuid: string;
  number: string;
  customerName: string | null;
  productCode: string | null;
}

// ── Rows (internal id/companyId kept; stripped by the controller mapping) ──

export interface ICorrugatorPlan {
  id?: number;
  companyId?: number;
  uuid?: string;
  number?: number;
  name?: string | null;
  notes?: string | null;
  status?: CorrugatorPlanStatus;
  board?: CorrugatorBoard;
  machines?: CorrugatorMachineSnapshot[];
  parameters?: CorrugatorParameters;
  solveToken?: string | null;
  solveStartedAt?: Date | null;
  solveFinishedAt?: Date | null;
  solveStatus?: CorrugatorSolveStatus | null;
  solveLog?: string | null;
  combinationsGenerated?: number | null;
  registeredAt?: Date | null;
  registeredByUser?: string | null;
  createdByUser?: string | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Public projection only (GET detail): the five solve* columns folded into
  // one object per model.md's ICorrugatorPlan comment; `solveToken` is
  // internal-only and never appears here.
  solve?: ICorrugatorSolveInfo;
  orders?: ICorrugatorPlanOrder[];
  combinations?: ICorrugatorPlanCombination[];
  summary?: ICorrugatorSummary | null;
  orderCount?: number;
  combinationCount?: number;
}

export interface ICorrugatorSolveInfo {
  status: CorrugatorSolveStatus | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  combinationsGenerated: number | null;
  log: string | null;
}

export interface ICorrugatorPlanOrder {
  id?: number;
  companyId?: number;
  uuid?: string;
  planId?: number;
  productionOrderId?: number;
  position?: number;
  number?: string;
  customerName?: string | null;
  productCode?: string | null;
  productDescription?: string | null;
  deliveryDate?: Date | null;
  sheetLength?: number;
  sheetWidth?: number;
  allowsRotation?: boolean;
  scoreLineCount?: number;
  orderQuantity?: number;
  sheetsPerUnit?: number;
  sheetsSource?: CorrugatorSheetsSource;
  requiredSheets?: number;
  pendingSheets?: number;
  requestedSheets?: number;
  underrunPercentage?: number;
  overrunPercentage?: number;
  priority?: CorrugatorPriority;
  partialProduction?: boolean;
  allocatedSheets?: number | null;

  productionOrder?: IProductionOrderRef;

  // Computed (evaluate()'s OrderFigures, joined in by the id).
  lowerBound?: number;
  upperBound?: number;
  plannedSheets?: number;
  fulfillment?: number;
  state?: CorrugatorFulfillment;
}

export interface ICorrugatorPlanItem {
  id?: number;
  uuid?: string;
  combinationId?: number;
  planOrderId?: number;
  position?: number;
  count?: number;
  rotated?: boolean;

  order?: ICorrugatorPlanOrderRef;
  runLength?: number;
  runWidth?: number;
  plannedSheets?: number;
  strokes?: number;
  linearProduction?: number;
}

export interface ICorrugatorPlanCombination {
  id?: number;
  uuid?: string;
  planId?: number;
  machineKey?: string;
  sequence?: number;
  meters?: number;

  // Computed (evaluate()'s CombinationFigures).
  width?: number;
  trim?: number;
  transversalRefile?: number;
  refile?: number;
  fullRefile?: number;
  wasteLinear?: number | null;
  scrapKg?: number | null;
  elements?: number;
  tables?: number;
  scoreLines?: number;
  items?: ICorrugatorPlanItem[];
}

export interface ICorrugatorPoolOrder {
  productionOrder: IProductionOrderRef;
  customer: { uuid: string; name: string } | null;
  product: { uuid: string; code: string; description: string | null };
  deliveryDate: Date | string | null;
  sheetLength: number;
  sheetWidth: number;
  allowsRotation: boolean;
  orderQuantity: number;
  sheetsPerUnit: number;
  sheetsSource: CorrugatorSheetsSource;
  requiredSheets: number;
  allocatedSheets: number;
  pendingSheets: number;
  inPlans: ICorrugatorPlanRef[];
}

export interface ICorrugatorPoolGroup {
  board: CorrugatorBoard;
  orders: ICorrugatorPoolOrder[];
}

export interface ICorrugatorNotPlannable {
  productionOrder: IProductionOrderRef;
  reason: CorrugatorNotPlannableReason;
  detail: string;
}

export interface ICorrugatorPool {
  groups: ICorrugatorPoolGroup[];
  notPlannable: ICorrugatorNotPlannable[];
}

/** `GET /corrugator-plans/:uuid/candidates` — one enumerated candidate (D-18). */
export interface ICorrugatorCandidate {
  machineKey: string;
  items: { orderUuid: string; count: number; rotated: boolean }[];
  trim: number;
  transversalRefile: number;
  refile: number;
  fullRefile: number;
  suggestedMeters: number;
}

/** `~ GET /production-orders/:uuid` additive block (D-9). */
export interface ICorrugatorOrderState {
  sheetsPerUnit: number;
  sheetsSource: CorrugatorSheetsSource;
  requiredSheets: number;
  allocatedSheets: number;
  pendingSheets: number;
  state: "none" | "partial" | "programada";
  plans: ICorrugatorPlanRef[];
}
