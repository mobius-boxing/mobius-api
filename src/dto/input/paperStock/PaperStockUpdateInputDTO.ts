export class PaperStockUpdateInputDTO {
  warehouseId?: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  paperSupplyId?: number;
  comments?: string;
  price?: number;
  weight?: number;
  diameter?: number;
  width?: number;

  constructor(data: any) {
    if (data.warehouseId !== undefined)
      this.warehouseId =
        typeof data.warehouseId === "string"
          ? parseInt(data.warehouseId, 10)
          : data.warehouseId;
    if (data.warehouseLocationId !== undefined)
      this.warehouseLocationId =
        typeof data.warehouseLocationId === "string"
          ? parseInt(data.warehouseLocationId, 10)
          : data.warehouseLocationId;
    if (data.supplierId !== undefined)
      this.supplierId =
        typeof data.supplierId === "string"
          ? parseInt(data.supplierId, 10)
          : data.supplierId;
    if (data.manufacturerId !== undefined)
      this.manufacturerId =
        typeof data.manufacturerId === "string"
          ? parseInt(data.manufacturerId, 10)
          : data.manufacturerId;
    if (data.paperSupplyId !== undefined)
      this.paperSupplyId =
        typeof data.paperSupplyId === "string"
          ? parseInt(data.paperSupplyId, 10)
          : data.paperSupplyId;
    if (data.comments !== undefined) this.comments = data.comments;
    if (data.price !== undefined)
      this.price =
        typeof data.price === "string" ? parseFloat(data.price) : data.price;
    if (data.weight !== undefined)
      this.weight =
        typeof data.weight === "string" ? parseFloat(data.weight) : data.weight;
    if (data.diameter !== undefined)
      this.diameter =
        typeof data.diameter === "string"
          ? parseFloat(data.diameter)
          : data.diameter;
    if (data.width !== undefined)
      this.width =
        typeof data.width === "string" ? parseFloat(data.width) : data.width;
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
