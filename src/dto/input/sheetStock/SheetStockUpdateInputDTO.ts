export class SheetStockUpdateInputDTO {
  warehouseId?: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  paperSheetId?: number;
  comments?: string;
  price?: number;
  quantity?: number;

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
    if (data.paperSheetId !== undefined)
      this.paperSheetId =
        typeof data.paperSheetId === "string"
          ? parseInt(data.paperSheetId, 10)
          : data.paperSheetId;
    if (data.comments !== undefined) this.comments = data.comments;
    if (data.price !== undefined)
      this.price =
        typeof data.price === "string" ? parseFloat(data.price) : data.price;
    if (data.quantity !== undefined)
      this.quantity =
        typeof data.quantity === "string"
          ? parseInt(data.quantity, 10)
          : data.quantity;
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
