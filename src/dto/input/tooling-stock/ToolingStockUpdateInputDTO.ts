export class ToolingStockUpdateInputDTO {
  warehouseUuid?: string;
  warehouseLocationUuid?: string;
  supplierUuid?: string;
  manufacturerUuid?: string;
  toolingUuid?: string;
  comments?: string;
  price?: number;
  quantity?: number;

  constructor(data: any) {
    if (data.warehouseUuid !== undefined) this.warehouseUuid = data.warehouseUuid;
    if (data.warehouseLocationUuid !== undefined) this.warehouseLocationUuid = data.warehouseLocationUuid;
    if (data.supplierUuid !== undefined) this.supplierUuid = data.supplierUuid;
    if (data.manufacturerUuid !== undefined) this.manufacturerUuid = data.manufacturerUuid;
    if (data.toolingUuid !== undefined) this.toolingUuid = data.toolingUuid;
    if (data.comments !== undefined) this.comments = data.comments;
    if (data.price !== undefined) this.price = typeof data.price === 'string' ? parseFloat(data.price) : data.price;
    if (data.quantity !== undefined) this.quantity = typeof data.quantity === 'string' ? parseInt(data.quantity, 10) : data.quantity;
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
