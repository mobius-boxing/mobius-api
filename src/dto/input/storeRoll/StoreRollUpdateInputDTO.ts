export class StoreRollUpdateInputDTO {
  description?: string;
  minQuantity?: number;
  isActive?: boolean;

  constructor(data: any) {
    if (data.description !== undefined) this.description = data.description;
    if (data.minQuantity !== undefined) this.minQuantity = data.minQuantity;
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
