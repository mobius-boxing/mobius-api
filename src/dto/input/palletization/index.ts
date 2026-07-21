const num = (v: any): number | undefined =>
  v === undefined ? undefined : typeof v === "string" ? parseFloat(v) : v;
const int = (v: any): number | undefined =>
  v === undefined ? undefined : typeof v === "string" ? parseInt(v, 10) : v;

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
    if (num(data.length) !== undefined) this.length = num(data.length);
    if (num(data.width) !== undefined) this.width = num(data.width);
    if (num(data.weight) !== undefined) this.weight = num(data.weight);
    if (num(data.height) !== undefined) this.height = num(data.height);
  }

  public build(): this {
    return this;
  }
}

export class PalletTypeUpdateInputDTO extends PalletTypeCreateInputDTO {
  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) delete this[key as keyof this];
    });
    return this;
  }
}

export class PalletizationCreateInputDTO {
  code?: string;
  name: string;
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
    this.name = data.name;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (int(data.boxesPerPackage) !== undefined) this.boxesPerPackage = int(data.boxesPerPackage);
    if (int(data.packagesPerLevel) !== undefined) this.packagesPerLevel = int(data.packagesPerLevel);
    if (int(data.levelsPerPallet) !== undefined) this.levelsPerPallet = int(data.levelsPerPallet);
    if (int(data.additionalPackages) !== undefined) this.additionalPackages = int(data.additionalPackages);
    if (int(data.sheetsPerPallet) !== undefined) this.sheetsPerPallet = int(data.sheetsPerPallet);
    if (num(data.maxPalletHeight) !== undefined) this.maxPalletHeight = num(data.maxPalletHeight);
    if (num(data.surface) !== undefined) this.surface = num(data.surface);
    if (data.stackingType !== undefined) this.stackingType = data.stackingType;
    if (data.observations !== undefined) this.observations = data.observations;
    if (data.technicalFileUuid !== undefined) this.technicalFileUuid = data.technicalFileUuid;
    if (data.imageFileUuid !== undefined) this.imageFileUuid = data.imageFileUuid;
    if (data.palletTypeUuid !== undefined) this.palletTypeUuid = data.palletTypeUuid;
  }

  public build(): this {
    return this;
  }
}

export class PalletizationUpdateInputDTO extends PalletizationCreateInputDTO {
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
