export class SheetStockCreateInputDTO {
  warehouseId: number;
  warehouseLocationId?: number;
  supplierId?: number;
  manufacturerId?: number;
  paperSheetId: number;
  comments?: string;
  price?: number;
  quantity: number;

  constructor(data: any) {
    this.warehouseId =
      typeof data.warehouseId === "string"
        ? parseInt(data.warehouseId, 10)
        : data.warehouseId;
    this.paperSheetId =
      typeof data.paperSheetId === "string"
        ? parseInt(data.paperSheetId, 10)
        : data.paperSheetId;
    this.quantity =
      typeof data.quantity === "string"
        ? parseInt(data.quantity, 10)
        : data.quantity ?? 0;
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
    if (data.comments !== undefined) this.comments = data.comments;
    if (data.price !== undefined)
      this.price =
        typeof data.price === "string" ? parseFloat(data.price) : data.price;
  }

  public build(): this {
    return this;
  }
}
