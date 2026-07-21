const num = (v: any): number | undefined =>
  v === undefined || v === null || v === ""
    ? undefined
    : typeof v === "string"
      ? parseFloat(v)
      : v;

const DIRECTIONS = ["input", "output"];
const SUPPLY_TYPES = ["paper", "sheet", "consumable", "tooling", "finishedGood"];

export interface IStageSupplyInput {
  direction: string;
  supplyType: string;
  supplyUuid: string;
  quantity?: number;
  quantityType?: string;
  repetitionsWidth?: number;
  repetitionsLength?: number;
  allowsSimilar?: boolean;
  notes?: string;
}

export interface IStageInput {
  number?: number;
  description?: string;
  isCorrugation?: boolean;
  setupTimeMinutes?: number;
  machineTypeUuid?: string;
  machines?: Array<{ machineUuid: string; isPrimary?: boolean }>;
  supplies?: IStageSupplyInput[];
}

const sanitizeStages = (stages: any): IStageInput[] | undefined => {
  if (!Array.isArray(stages)) return undefined;
  return stages.map((stage: any) => ({
    number: num(stage?.number),
    description: stage?.description,
    isCorrugation: stage?.isCorrugation === true,
    setupTimeMinutes: num(stage?.setupTimeMinutes) ?? 0,
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
              DIRECTIONS.includes(s?.direction) &&
              SUPPLY_TYPES.includes(s?.supplyType),
          )
          .map((s: any) => ({
            direction: s.direction,
            supplyType: s.supplyType,
            supplyUuid: s.supplyUuid,
            quantity: num(s.quantity),
            quantityType: s.quantityType,
            repetitionsWidth: num(s.repetitionsWidth) ?? 1.0,
            repetitionsLength: num(s.repetitionsLength) ?? 1.0,
            allowsSimilar: s.allowsSimilar === true,
            notes: s.notes,
          }))
      : [],
  }));
};

export class ProductionRouteCreateInputDTO {
  name: string;
  isGlobal?: boolean;
  active?: boolean;
  isDefault?: boolean;
  stages?: IStageInput[];

  constructor(data: any) {
    this.name = data.name;
    if (data.isGlobal !== undefined) this.isGlobal = data.isGlobal === true;
    if (data.active !== undefined) this.active = data.active === true;
    if (data.isDefault !== undefined) this.isDefault = data.isDefault === true;
    const stages = sanitizeStages(data.stages);
    if (stages !== undefined) this.stages = stages;
  }

  public build(): this {
    return this;
  }
}

export class ProductionRouteUpdateInputDTO extends ProductionRouteCreateInputDTO {
  constructor(data: any) {
    super(data);
    if (data.name === undefined) delete (this as any).name;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) delete this[key as keyof this];
    });
    return this;
  }
}
