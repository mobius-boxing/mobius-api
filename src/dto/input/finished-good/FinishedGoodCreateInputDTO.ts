export class FinishedGoodCreateInputDTO {
  code?: string;
  name: string;
  description?: string;
  // SECURITY: accept UUIDs from the frontend, never numeric ids.
  supplierUuid?: string;
  manufacturerUuid?: string;
  minimumStock?: number;

  constructor(data: any) {
    this.name = data.name;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.manufacturerUuid !== undefined)
      this.manufacturerUuid = data.manufacturerUuid;
    if (data.minimumStock !== undefined) {
      this.minimumStock =
        typeof data.minimumStock === "string"
          ? parseFloat(data.minimumStock)
          : data.minimumStock;
    }
  }

  public build(): this {
    return this;
  }
}
