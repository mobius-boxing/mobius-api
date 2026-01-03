export class ToolingCreateInputDTO {
  name: string;
  description?: string;
  manufacturerUuid?: string;
  supplierUuid?: string;
  minimumStock?: number;
  toolingTypeUuid: string;

  constructor(data: any) {
    this.name = data.name;
    this.toolingTypeUuid = data.toolingTypeUuid;
    if (data.description !== undefined) this.description = data.description;
    if (data.manufacturerUuid !== undefined) this.manufacturerUuid = data.manufacturerUuid;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.minimumStock !== undefined) this.minimumStock = data.minimumStock;
  }

  public build(): this {
    return this;
  }
}
