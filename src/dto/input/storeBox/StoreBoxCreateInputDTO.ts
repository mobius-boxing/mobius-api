export class StoreBoxCreateInputDTO {
  description: string;
  unitsPerPackage: number;
  unitsPerPallet: number;
  isActive: boolean;

  constructor(data: any) {
    this.description = data.description;
    this.unitsPerPackage = data.unitsPerPackage;
    this.unitsPerPallet = data.unitsPerPallet;
    this.isActive = data.isActive ?? true;
  }

  public build(): this {
    return this;
  }
}
