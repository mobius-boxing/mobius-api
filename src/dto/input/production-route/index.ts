import {
  STAGE_DIRECTIONS,
  SUPPLY_TYPES,
  StageSupplyDirection,
  StageSupplyType,
} from "../../../interfaces/production-route/production-route.interfaces";
import { toNumberInput } from "../../../utils/numbers";

export interface IStageSupplyInput {
  /** Identity reference for the diff-and-upsert path (audit P1b); the API
   * never writes a client uuid, it only matches on one. */
  uuid?: string;
  direction: StageSupplyDirection;
  supplyType: StageSupplyType;
  supplyUuid: string;
  quantity?: number;
  quantityType?: string;
  repetitionsWidth?: number;
  repetitionsLength?: number;
  allowsSimilar?: boolean;
  notes?: string;
}

export interface IStageInput {
  /** See {@link IStageSupplyInput.uuid} — a reference, never a written value. */
  uuid?: string;
  number?: number;
  description?: string;
  isCorrugation?: boolean;
  setupTimeMinutes?: number;
  machineTypeUuid?: string;
  machines?: Array<{ machineUuid: string; isPrimary?: boolean }>;
  supplies?: IStageSupplyInput[];
}

/**
 * Child row identity, carried through so the DAO can upsert instead of
 * delete-and-reinsert (audit P1b). Anything that is not a string is dropped:
 * an unmatched value simply means "new row", so a hostile one costs nothing.
 */
const asUuidRef = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const sanitizeStages = (stages: any): IStageInput[] | undefined => {
  if (!Array.isArray(stages)) return undefined;
  return stages.map((stage: any) => ({
    uuid: asUuidRef(stage?.uuid),
    number: toNumberInput(stage?.number),
    description: stage?.description,
    isCorrugation: stage?.isCorrugation === true,
    setupTimeMinutes: toNumberInput(stage?.setupTimeMinutes) ?? 0,
    machineTypeUuid: stage?.machineTypeUuid,
    machines: Array.isArray(stage?.machines)
      ? stage.machines.map((m: any) => ({
          machineUuid: m?.machineUuid,
          isPrimary: m?.isPrimary !== false,
        }))
      : [],
    supplies: Array.isArray(stage?.supplies)
      ? stage.supplies
          .filter(
            (s: any) =>
              (STAGE_DIRECTIONS as readonly string[]).includes(s?.direction) &&
              (SUPPLY_TYPES as readonly string[]).includes(s?.supplyType),
          )
          .map((s: any) => ({
            uuid: asUuidRef(s.uuid),
            direction: s.direction,
            supplyType: s.supplyType,
            supplyUuid: s.supplyUuid,
            quantity: toNumberInput(s.quantity),
            quantityType: s.quantityType,
            repetitionsWidth: toNumberInput(s.repetitionsWidth) ?? 1.0,
            repetitionsLength: toNumberInput(s.repetitionsLength) ?? 1.0,
            allowsSimilar: s.allowsSimilar === true,
            notes: s.notes,
          }))
      : [],
  }));
};

/** Physically-nonsensical numerics rejected here; V-rules run at save. */
const validateStages = (stages: IStageInput[] | undefined): void => {
  if (!stages) return;
  for (const stage of stages) {
    if (stage.setupTimeMinutes !== undefined && stage.setupTimeMinutes < 0)
      throw new Error("Stage setup time must be non-negative");
    for (const supply of stage.supplies ?? []) {
      if (supply.quantity !== undefined && supply.quantity < 0)
        throw new Error("Stage supply quantity must be non-negative");
      if (
        (supply.repetitionsWidth !== undefined &&
          supply.repetitionsWidth < 0) ||
        (supply.repetitionsLength !== undefined && supply.repetitionsLength < 0)
      )
        throw new Error("Stage supply repetitions must be non-negative");
      if (!supply.supplyUuid)
        throw new Error("Stage supply must reference a supply");
    }
  }
};

export class ProductionRouteCreateInputDTO {
  name!: string;
  isGlobal?: boolean;
  active?: boolean;
  isDefault?: boolean;
  stages?: IStageInput[];

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.isGlobal !== undefined) this.isGlobal = data.isGlobal === true;
    if (data.active !== undefined) this.active = data.active === true;
    if (data.isDefault !== undefined) this.isDefault = data.isDefault === true;
    const stages = sanitizeStages(data.stages);
    if (stages !== undefined) this.stages = stages;
  }

  public build(): this {
    // V1 (name required) is also a save-time Critico, but reject the obvious
    // case up front — inputValidator itself checks nothing.
    if (!this.name || !String(this.name).trim())
      throw new Error("Route name is required");
    validateStages(this.stages);
    return this;
  }
}

export class ProductionRouteUpdateInputDTO extends ProductionRouteCreateInputDTO {
  constructor(data: any) {
    super(data);
    if (data.name === undefined) delete (this as any).name;
  }

  public build(): this {
    if (this.name !== undefined && !String(this.name).trim())
      throw new Error("Route name cannot be empty");
    validateStages(this.stages);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
