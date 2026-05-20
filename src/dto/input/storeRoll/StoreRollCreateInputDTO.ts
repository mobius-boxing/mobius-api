export class StoreRollCreateInputDTO {
  description: string;
  minQuantity: number;
  isActive: boolean;

  constructor(data: any) {
    this.description = data.description;
    this.minQuantity = data.minQuantity;
    this.isActive = data.isActive ?? true;
  }

  public build(): this {
    return this;
  }
}
