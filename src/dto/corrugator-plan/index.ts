/**
 * corrugator-plan DTOs. Given the endpoint count (create/update plan, three
 * line verbs, four adjust verbs, register) these stay in one file rather than
 * one-class-per-file (allowlist: `src/dto/corrugator-plan/*`). Validation is
 * plain — throw a descriptive `Error` in `build()` (mobius-api/CLAUDE.md's
 * "DTOs must THROW inside build()"); this is a brand-new Mobius-native entity
 * with no Procusto-parity Spanish strings to match, unlike `machine`'s DTOs.
 */
import {
  CorrugatorParameters,
  CorrugatorPriority,
  ICorrugatorPlanMachineInput,
} from "../../interfaces/corrugator-plan/corrugator-plan.interfaces";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export class CorrugatorPlanCreateInputDTO {
  name?: string | null;
  notes?: string | null;
  productionOrderUuids!: string[];
  machines!: ICorrugatorPlanMachineInput[];
  parameters?: Partial<CorrugatorParameters>;

  constructor(data: any) {
    if (data?.name !== undefined) this.name = data.name;
    if (data?.notes !== undefined) this.notes = data.notes;
    this.productionOrderUuids = data?.productionOrderUuids;
    this.machines = data?.machines;
    if (data?.parameters !== undefined) this.parameters = data.parameters;
  }

  public build(): this {
    if (
      !Array.isArray(this.productionOrderUuids) ||
      this.productionOrderUuids.length === 0 ||
      !this.productionOrderUuids.every(isNonEmptyString)
    ) {
      throw new Error(
        "productionOrderUuids must be a non-empty array of uuids",
      );
    }
    if (!Array.isArray(this.machines) || this.machines.length === 0) {
      throw new Error("machines must be a non-empty array");
    }
    for (const m of this.machines) {
      if (!m || !isNonEmptyString(m.machineUuid)) {
        throw new Error("Each machines entry needs a machineUuid");
      }
      if (
        m.widths !== undefined &&
        (!Array.isArray(m.widths) ||
          !m.widths.every((w: unknown) => typeof w === "number" && w > 0))
      ) {
        throw new Error(
          "machines[].widths must be an array of positive numbers",
        );
      }
    }
    if (
      this.parameters !== undefined &&
      (typeof this.parameters !== "object" ||
        this.parameters === null ||
        Array.isArray(this.parameters))
    ) {
      throw new Error("parameters must be an object");
    }
    return this;
  }
}

export class CorrugatorPlanUpdateInputDTO {
  name?: string | null;
  notes?: string | null;
  parameters?: Partial<CorrugatorParameters>;
  machines?: ICorrugatorPlanMachineInput[];

  constructor(data: any) {
    if (data?.name !== undefined) this.name = data.name;
    if (data?.notes !== undefined) this.notes = data.notes;
    if (data?.parameters !== undefined) this.parameters = data.parameters;
    if (data?.machines !== undefined) this.machines = data.machines;
  }

  public build(): this {
    if (this.machines !== undefined) {
      if (!Array.isArray(this.machines) || this.machines.length === 0) {
        throw new Error("machines must be a non-empty array");
      }
      for (const m of this.machines) {
        if (!m || !isNonEmptyString(m.machineUuid)) {
          throw new Error("Each machines entry needs a machineUuid");
        }
      }
    }
    if (
      this.parameters !== undefined &&
      (typeof this.parameters !== "object" ||
        this.parameters === null ||
        Array.isArray(this.parameters))
    ) {
      throw new Error("parameters must be an object");
    }
    return this;
  }
}

export class CorrugatorPlanOrdersCreateInputDTO {
  productionOrderUuids!: string[];

  constructor(data: any) {
    this.productionOrderUuids = data?.productionOrderUuids;
  }

  public build(): this {
    if (
      !Array.isArray(this.productionOrderUuids) ||
      this.productionOrderUuids.length === 0 ||
      !this.productionOrderUuids.every(isNonEmptyString)
    ) {
      throw new Error(
        "productionOrderUuids must be a non-empty array of uuids",
      );
    }
    return this;
  }
}

const PRIORITIES: readonly CorrugatorPriority[] = [
  "normal",
  "mandatory",
  "optional",
];

export class CorrugatorPlanOrderUpdateInputDTO {
  requestedSheets?: number;
  sheetsPerUnit?: number;
  underrunPercentage?: number;
  overrunPercentage?: number;
  priority?: CorrugatorPriority;
  partialProduction?: boolean;
  allowsRotation?: boolean;
  position?: number;

  constructor(data: any) {
    for (const key of [
      "requestedSheets",
      "sheetsPerUnit",
      "underrunPercentage",
      "overrunPercentage",
      "priority",
      "partialProduction",
      "allowsRotation",
      "position",
    ] as const) {
      if (data?.[key] !== undefined) (this as any)[key] = data[key];
    }
  }

  public build(): this {
    if (this.requestedSheets !== undefined) {
      if (
        typeof this.requestedSheets !== "number" ||
        !Number.isInteger(this.requestedSheets) ||
        this.requestedSheets < 1
      ) {
        throw new Error("requestedSheets must be an integer >= 1");
      }
    }
    if (this.sheetsPerUnit !== undefined) {
      if (typeof this.sheetsPerUnit !== "number" || !(this.sheetsPerUnit > 0)) {
        throw new Error("sheetsPerUnit must be a number > 0");
      }
    }
    if (
      this.underrunPercentage !== undefined &&
      typeof this.underrunPercentage !== "number"
    ) {
      throw new Error("underrunPercentage must be a number");
    }
    if (
      this.overrunPercentage !== undefined &&
      typeof this.overrunPercentage !== "number"
    ) {
      throw new Error("overrunPercentage must be a number");
    }
    if (this.priority !== undefined && !PRIORITIES.includes(this.priority)) {
      throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
    }
    if (
      this.partialProduction !== undefined &&
      typeof this.partialProduction !== "boolean"
    ) {
      throw new Error("partialProduction must be a boolean");
    }
    if (
      this.allowsRotation !== undefined &&
      typeof this.allowsRotation !== "boolean"
    ) {
      throw new Error("allowsRotation must be a boolean");
    }
    if (
      this.position !== undefined &&
      (typeof this.position !== "number" ||
        !Number.isInteger(this.position) ||
        this.position < 0)
    ) {
      throw new Error("position must be an integer >= 0");
    }
    return this;
  }
}

export class CorrugatorCombinationCreateInputDTO {
  machineKey!: string;
  items!: { orderUuid: string; count: number; rotated?: boolean }[];
  meters?: number;

  constructor(data: any) {
    this.machineKey = data?.machineKey;
    this.items = data?.items;
    if (data?.meters !== undefined) this.meters = data.meters;
  }

  public build(): this {
    if (!isNonEmptyString(this.machineKey))
      throw new Error("machineKey is required");
    if (!Array.isArray(this.items) || this.items.length === 0) {
      throw new Error("items must be a non-empty array");
    }
    for (const it of this.items) {
      if (!it || !isNonEmptyString(it.orderUuid))
        throw new Error("Each item needs an orderUuid");
      if (
        typeof it.count !== "number" ||
        !Number.isInteger(it.count) ||
        it.count < 1
      ) {
        throw new Error("Each item's count must be an integer >= 1");
      }
      if (it.rotated !== undefined && typeof it.rotated !== "boolean") {
        throw new Error("rotated must be a boolean");
      }
    }
    if (
      this.meters !== undefined &&
      (typeof this.meters !== "number" || this.meters < 0)
    ) {
      throw new Error("meters must be a number >= 0");
    }
    return this;
  }
}

/** `{meters}` | `{plannedSheets:{itemUuid,value}}` | `{sequence}` | `{machineKey}` (D-44) — exactly one. */
export class CorrugatorCombinationUpdateInputDTO {
  meters?: number;
  plannedSheets?: { itemUuid: string; value: number };
  sequence?: number;
  machineKey?: string;

  constructor(data: any) {
    if (data?.meters !== undefined) this.meters = data.meters;
    if (data?.plannedSheets !== undefined)
      this.plannedSheets = data.plannedSheets;
    if (data?.sequence !== undefined) this.sequence = data.sequence;
    if (data?.machineKey !== undefined) this.machineKey = data.machineKey;
  }

  public build(): this {
    const present = [
      this.meters,
      this.plannedSheets,
      this.sequence,
      this.machineKey,
    ].filter((v) => v !== undefined).length;
    if (present !== 1) {
      throw new Error(
        "Exactly one of meters, plannedSheets, sequence, machineKey is required",
      );
    }
    if (
      this.meters !== undefined &&
      (typeof this.meters !== "number" || this.meters < 0)
    ) {
      throw new Error("meters must be a number >= 0");
    }
    if (this.plannedSheets !== undefined) {
      if (
        !this.plannedSheets ||
        !isNonEmptyString(this.plannedSheets.itemUuid) ||
        typeof this.plannedSheets.value !== "number" ||
        this.plannedSheets.value < 0
      ) {
        throw new Error("plannedSheets must be {itemUuid, value >= 0}");
      }
    }
    if (
      this.sequence !== undefined &&
      (typeof this.sequence !== "number" ||
        !Number.isInteger(this.sequence) ||
        this.sequence < 1)
    ) {
      throw new Error("sequence must be an integer >= 1");
    }
    if (this.machineKey !== undefined && !isNonEmptyString(this.machineKey)) {
      throw new Error("machineKey must be a non-empty string");
    }
    return this;
  }
}

export class CorrugatorRegisterInputDTO {
  force?: boolean;

  constructor(data: any) {
    if (data?.force !== undefined) this.force = data.force;
  }

  public build(): this {
    if (this.force !== undefined && typeof this.force !== "boolean") {
      throw new Error("force must be a boolean");
    }
    return this;
  }
}
