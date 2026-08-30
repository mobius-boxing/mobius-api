export class ConsumableStockCreateInputDTO {
  warehouseUuid: string;
  warehouseLocationUuid?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  consumableSupplyUuid: string;
  comments?: string;
  price?: number;
  quantity: number;

  constructor(data: any) {
    this.warehouseUuid = data.warehouseUuid;
    this.consumableSupplyUuid = data.consumableSupplyUuid;
    this.quantity =
      typeof data.quantity === "string"
        ? parseInt(data.quantity, 10)
        : data.quantity;
    if (data.warehouseLocationUuid !== undefined)
      this.warehouseLocationUuid = data.warehouseLocationUuid;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.manufacturerUuid !== undefined)
      this.manufacturerUuid = data.manufacturerUuid;
    if (data.comments !== undefined) this.comments = data.comments;
    if (data.price !== undefined)
      this.price =
        typeof data.price === "string" ? parseFloat(data.price) : data.price;
  }

  public build(): this {
    return this;
  }
}
