import { toNumberInput, toIntInput } from "../../../utils/numbers";

const NUMERIC_KEYS = [
  "sheetWidthMin",
  "sheetLengthMin",
  "sheetWidthMax",
  "sheetLengthMax",
  "width",
  "setupTime",
  "maxScoreLines",
  "linearMeters",
  "boxWidthMin",
  "boxWidthMax",
  "boxLengthMin",
  "boxLengthMax",
  "boxHeightMin",
  "boxHeightMax",
] as const;

type MachineNumericKey = (typeof NUMERIC_KEYS)[number];

export class MachineTypeCreateInputDTO {
  name!: string;
  location?: number;
  requiresDie?: boolean;
  requiresPlate?: boolean;
  attribute?: string;
  corrugated?: boolean;
  generatesSheets?: boolean;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    const location = toIntInput(data.location);
    if (location !== undefined) this.location = location;
    if (data.requiresDie !== undefined) this.requiresDie = data.requiresDie === true;
    if (data.requiresPlate !== undefined) this.requiresPlate = data.requiresPlate === true;
    if (data.attribute !== undefined) this.attribute = data.attribute;
    if (data.corrugated !== undefined) this.corrugated = data.corrugated === true;
    if (data.generatesSheets !== undefined)
      this.generatesSheets = data.generatesSheets === true;
  }

  public build(): this {
    // machine_types.name is NOT NULL — enforce here; inputValidator checks nothing.
    if (!this.name || !String(this.name).trim())
      throw new Error("Machine type name is required");
    return this;
  }
}

export class MachineTypeUpdateInputDTO extends MachineTypeCreateInputDTO {
  public build(): this {
    if (this.name !== undefined && !String(this.name).trim())
      throw new Error("Machine type name cannot be empty");
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

/** Closed allow-list (no index signature — see CLAUDE.md validation rule). */
export class MachineCreateInputDTO {
  code?: string;
  description?: string;
  // SECURITY: UUIDs from the client, resolved to ids in the controller.
  machineTypeUuid!: string;
  sourceWarehouseUuid?: string;
  destinationWarehouseUuid?: string;
  sheetWidthMin?: number;
  sheetLengthMin?: number;
  sheetWidthMax?: number;
  sheetLengthMax?: number;
  width?: number;
  setupTime?: number;
  maxScoreLines?: number;
  linearMeters?: number;
  boxWidthMin?: number;
  boxWidthMax?: number;
  boxLengthMin?: number;
  boxLengthMax?: number;
  boxHeightMin?: number;
  boxHeightMax?: number;

  constructor(data: any) {
    if (data.machineTypeUuid !== undefined) this.machineTypeUuid = data.machineTypeUuid;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.sourceWarehouseUuid !== undefined)
      this.sourceWarehouseUuid = data.sourceWarehouseUuid;
    if (data.destinationWarehouseUuid !== undefined)
      this.destinationWarehouseUuid = data.destinationWarehouseUuid;
    const self = this as Record<string, unknown>;
    for (const key of NUMERIC_KEYS) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
  }

  /** Dimensions/times are physically non-negative. */
  protected validateNumerics(): void {
    const self = this as Partial<Record<MachineNumericKey, number>>;
    for (const key of NUMERIC_KEYS) {
      const v = self[key];
      if (v !== undefined && v < 0)
        throw new Error(`${key} must be non-negative`);
    }
  }

  public build(): this {
    if (!this.machineTypeUuid) throw new Error("machineTypeUuid is required");
    this.validateNumerics();
    return this;
  }
}

export class MachineUpdateInputDTO extends MachineCreateInputDTO {
  public build(): this {
    if (this.machineTypeUuid !== undefined && !this.machineTypeUuid)
      throw new Error("machineTypeUuid cannot be empty");
    this.validateNumerics();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
