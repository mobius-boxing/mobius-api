export class PaperSupplyCreateInputDTO {
  companyId: number;
  code: string;
  description?: string;
  name?: string;
  manufacturerId?: number;
  supplierId?: number;
  minimumStock?: { pallets: number; boxes: number };

  constructor(data: any) {
    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : data.companyId;
    this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.name !== undefined) this.name = data.name;
    if (data.manufacturerId !== undefined)
      this.manufacturerId =
        typeof data.manufacturerId === "string"
          ? parseInt(data.manufacturerId, 10)
          : data.manufacturerId;
    if (data.supplierId !== undefined)
      this.supplierId =
        typeof data.supplierId === "string"
          ? parseInt(data.supplierId, 10)
          : data.supplierId;
    if (data.minimumStock !== undefined) {
      this.minimumStock = data.minimumStock;
    } else {
      this.minimumStock = { pallets: 0, boxes: 0 };
    }
  }

  public build(): this {
    return this;
  }
}
