export class PaperSupplyUpdateInputDTO {
  code?: string;
  description?: string;
  name?: string;
  manufacturerId?: number;
  supplierId?: number;
  paperTypeId?: number;
  grammage?: number;
  price?: number;
  minimumStock?: { pallets: number; boxes: number };

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
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
    if (data.paperTypeId !== undefined)
      this.paperTypeId =
        typeof data.paperTypeId === "string"
          ? parseInt(data.paperTypeId, 10)
          : data.paperTypeId;
    if (data.grammage !== undefined)
      this.grammage =
        typeof data.grammage === "string"
          ? parseFloat(data.grammage)
          : data.grammage;
    if (data.price !== undefined)
      this.price =
        typeof data.price === "string" ? parseFloat(data.price) : data.price;
    if (data.minimumStock !== undefined) this.minimumStock = data.minimumStock;
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
