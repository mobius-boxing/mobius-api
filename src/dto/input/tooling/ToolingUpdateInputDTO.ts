export class ToolingUpdateInputDTO {
  name?: string;
  description?: string;
  manufacturerUuid?: string;
  supplierUuid?: string;
  minimumStock?: number;
  toolingTypeUuid?: string;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.manufacturerUuid !== undefined) this.manufacturerUuid = data.manufacturerUuid;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.minimumStock !== undefined) this.minimumStock = data.minimumStock;
    if (data.toolingTypeUuid !== undefined) this.toolingTypeUuid = data.toolingTypeUuid;
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
