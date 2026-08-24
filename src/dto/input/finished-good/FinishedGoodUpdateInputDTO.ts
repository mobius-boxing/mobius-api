export class FinishedGoodUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  minimumStock?: number;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
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
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
