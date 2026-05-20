export class StoreBoxUpdateInputDTO {
  description?: string;
  unitsPerPackage?: number;
  unitsPerPallet?: number;
  isActive?: boolean;

  constructor(data: any) {
    if (data.description !== undefined) this.description = data.description;
    if (data.unitsPerPackage !== undefined)
      this.unitsPerPackage = data.unitsPerPackage;
    if (data.unitsPerPallet !== undefined)
      this.unitsPerPallet = data.unitsPerPallet;
    if (data.isActive !== undefined) this.isActive = data.isActive;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
