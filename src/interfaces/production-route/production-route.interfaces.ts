/**
 * Supply-type vocabulary — SINGLE SOURCE. The type union, the DTO's
 * validation list, the DAO's table lookup, and the validator's unit subset
 * all derive from this map; adding a type here propagates (or fails to
 * compile) everywhere.
 */
export const SUPPLY_TABLES = {
  paper: "paper_supplies",
  sheet: "paper_sheets",
  consumable: "consumable_supplies",
  tooling: "toolings",
  finishedGood: "finished_goods",
} as const;
export type StageSupplyType = keyof typeof SUPPLY_TABLES;
export const SUPPLY_TYPES = Object.keys(SUPPLY_TABLES) as StageSupplyType[];

export const STAGE_DIRECTIONS = ["input", "output"] as const;
export type StageSupplyDirection = (typeof STAGE_DIRECTIONS)[number];

/** Unit-bearing types for Bocas (CalculosBocas: only these sum as units). */
export const BOCAS_UNIT_TYPES: StageSupplyType[] = ["sheet", "finishedGood"];

export interface IStageSupply {
  id?: number;
  uuid?: string;
  direction: StageSupplyDirection;
  supplyType: StageSupplyType;
  supplyId: number;
  quantity?: number | null;
  quantityType?: string | null;
  repetitionsWidth: number;
  repetitionsLength: number;
  allowsSimilar: boolean;
  notes?: string | null;
  // Populated on read (uuid-only surface)
  supply?: { uuid: string; code?: string | null; name?: string | null } | null;
}

export interface IStageMachine {
  machineId?: number;
  isPrimary: boolean;
  // Populated on read
  machine?: { uuid: string; code?: string | null; description?: string | null } | null;
}

export interface IRouteStage {
  id?: number;
  uuid?: string;
  number: number;
  description?: string | null;
  isCorrugation?: boolean | null;
  setupTimeMinutes: number;
  machineTypeId?: number | null;
  machines: IStageMachine[];
  supplies: IStageSupply[];
  // Populated on read
  machineType?: { uuid: string; name?: string; corrugated?: boolean } | null;
}

export interface IProductionRoute {
  id?: number;
  uuid?: string;
  companyId?: number;
  name: string;
  isGlobal: boolean;
  active: boolean;
  isDefault: boolean;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  stages?: IRouteStage[];
  stageCount?: number;
}

export interface IRouteProblem {
  code: string;
  message: string;
  stageNumber?: number;
}

export interface IRouteValidation {
  critical: IRouteProblem[];
  warnings: IRouteProblem[];
}
