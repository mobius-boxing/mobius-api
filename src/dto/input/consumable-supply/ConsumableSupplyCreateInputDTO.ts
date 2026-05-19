export class ConsumableSupplyCreateInputDTO {
  code: string;
  name: string;
  description?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  consumableTypeUuid?: string;

  constructor(data: any) {
    this.code = data.code;
    this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.manufacturerUuid !== undefined) this.manufacturerUuid = data.manufacturerUuid;
    if (data.consumableTypeUuid !== undefined) this.consumableTypeUuid = data.consumableTypeUuid;
  }

  public build(): this {
    return this;
  }
}
