import { toNumberInput, toIntInput } from "../../../utils/numbers";

const PALLET_TYPE_NUMERIC = ["length", "width", "weight", "height"] as const;

export class PalletTypeCreateInputDTO {
  code?: string;
  description?: string;
  length?: number;
  width?: number;
  weight?: number;
  height?: number;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    const self = this as Record<string, unknown>;
    for (const key of PALLET_TYPE_NUMERIC) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
  }

  protected validateNumerics(): void {
    const self = this as Partial<Record<(typeof PALLET_TYPE_NUMERIC)[number], number>>;
    for (const key of PALLET_TYPE_NUMERIC) {
      const v = self[key];
      if (v !== undefined && v < 0) throw new Error(`${key} must be non-negative`);
    }
  }

  public build(): this {
    this.validateNumerics();
    return this;
  }
}

export class PalletTypeUpdateInputDTO extends PalletTypeCreateInputDTO {
  public build(): this {
    this.validateNumerics();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

const PALLETIZATION_INT = [
  "boxesPerPackage",
  "packagesPerLevel",
  "levelsPerPallet",
  "additionalPackages",
  "sheetsPerPallet",
] as const;
const PALLETIZATION_NUMERIC = ["maxPalletHeight", "surface"] as const;

export class PalletizationCreateInputDTO {
  code?: string;
  name!: string;
  description?: string;
  boxesPerPackage?: number;
  packagesPerLevel?: number;
  levelsPerPallet?: number;
  additionalPackages?: number;
  sheetsPerPallet?: number;
  maxPalletHeight?: number;
  surface?: number;
  stackingType?: string;
  observations?: string;
  // SECURITY: file + lookup references arrive as UUIDs.
  technicalFileUuid?: string;
  imageFileUuid?: string;
  palletTypeUuid?: string;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.stackingType !== undefined) this.stackingType = data.stackingType;
    if (data.observations !== undefined) this.observations = data.observations;
    if (data.technicalFileUuid !== undefined) this.technicalFileUuid = data.technicalFileUuid;
    if (data.imageFileUuid !== undefined) this.imageFileUuid = data.imageFileUuid;
    if (data.palletTypeUuid !== undefined) this.palletTypeUuid = data.palletTypeUuid;
    const self = this as Record<string, unknown>;
    for (const key of PALLETIZATION_INT) {
      const v = toIntInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
    for (const key of PALLETIZATION_NUMERIC) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
  }

  protected validateNumerics(): void {
    const self = this as Partial<
      Record<
        (typeof PALLETIZATION_INT)[number] | (typeof PALLETIZATION_NUMERIC)[number],
        number
      >
    >;
    for (const key of [...PALLETIZATION_INT, ...PALLETIZATION_NUMERIC]) {
      const v = self[key];
      if (v !== undefined && v < 0) throw new Error(`${key} must be non-negative`);
    }
  }

  public build(): this {
    // palletizations.name is NOT NULL — inputValidator checks nothing.
    if (!this.name || !String(this.name).trim())
      throw new Error("Palletization name is required");
    this.validateNumerics();
    return this;
  }
}

export class PalletizationUpdateInputDTO extends PalletizationCreateInputDTO {
  public build(): this {
    if (this.name !== undefined && !String(this.name).trim())
      throw new Error("Palletization name cannot be empty");
    this.validateNumerics();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
