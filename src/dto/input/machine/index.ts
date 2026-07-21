const num = (v: any): number | undefined =>
  v === undefined ? undefined : typeof v === "string" ? parseFloat(v) : v;

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

export class MachineTypeCreateInputDTO {
  name: string;
  location?: number;
  requiresDie?: boolean;
  requiresPlate?: boolean;
  attribute?: string;
  corrugated?: boolean;
  generatesSheets?: boolean;

  constructor(data: any) {
    this.name = data.name;
    if (num(data.location) !== undefined) this.location = num(data.location);
    if (data.requiresDie !== undefined) this.requiresDie = data.requiresDie === true;
    if (data.requiresPlate !== undefined) this.requiresPlate = data.requiresPlate === true;
    if (data.attribute !== undefined) this.attribute = data.attribute;
    if (data.corrugated !== undefined) this.corrugated = data.corrugated === true;
    if (data.generatesSheets !== undefined)
      this.generatesSheets = data.generatesSheets === true;
  }

  public build(): this {
    return this;
  }
}

export class MachineTypeUpdateInputDTO extends MachineTypeCreateInputDTO {
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

export class MachineCreateInputDTO {
  code?: string;
  description?: string;
  // SECURITY: UUIDs from the client, resolved to ids in the controller.
  machineTypeUuid: string;
  sourceWarehouseUuid?: string;
  destinationWarehouseUuid?: string;
  [key: string]: any;

  constructor(data: any) {
    this.machineTypeUuid = data.machineTypeUuid;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.sourceWarehouseUuid !== undefined)
      this.sourceWarehouseUuid = data.sourceWarehouseUuid;
    if (data.destinationWarehouseUuid !== undefined)
      this.destinationWarehouseUuid = data.destinationWarehouseUuid;
    for (const key of NUMERIC_KEYS) {
      if (num(data[key]) !== undefined) this[key] = num(data[key]);
    }
  }

  public build(): this {
    return this;
  }
}

export class MachineUpdateInputDTO extends MachineCreateInputDTO {
  constructor(data: any) {
    super(data);
    if (data.machineTypeUuid === undefined) delete (this as any).machineTypeUuid;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) delete this[key as keyof this];
    });
    return this;
  }
}
