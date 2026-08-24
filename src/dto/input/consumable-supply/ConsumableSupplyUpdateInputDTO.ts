export class ConsumableSupplyUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  consumableTypeUuid?: string;
  location?: string;
  /** FREE TEXT by design — live Procusto stores strings like "15-07-22" (Q-09-8). */
  expiry?: string;
  minimumStock?: number | null;
  colorUuid?: string;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.manufacturerUuid !== undefined) this.manufacturerUuid = data.manufacturerUuid;
    if (data.consumableTypeUuid !== undefined) this.consumableTypeUuid = data.consumableTypeUuid;
    if (data.location !== undefined) this.location = data.location;
    if (data.expiry !== undefined) this.expiry = data.expiry;
    if (data.minimumStock !== undefined)
      this.minimumStock =
        data.minimumStock === null
          ? null
          : typeof data.minimumStock === "string"
            ? parseFloat(data.minimumStock)
            : data.minimumStock;
    if (data.colorUuid !== undefined) this.colorUuid = data.colorUuid;
  }

  public build(): this {
    Object.keys(this).forEach(key => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
