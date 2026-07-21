export type StageSupplyDirection = "input" | "output";
export type StageSupplyType =
  | "paper"
  | "sheet"
  | "consumable"
  | "tooling"
  | "finishedGood";

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
