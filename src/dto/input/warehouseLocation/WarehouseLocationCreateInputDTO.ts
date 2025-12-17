export class WarehouseLocationCreateInputDTO {
  warehouseId: number;
  row: number;
  col: number;
  status: string;
  locationType: string;
  locationCode?: string;
  capacity?: any;
  metadata?: any;

  constructor(data: any) {
    this.warehouseId = typeof data.warehouseId === "string" ? parseInt(data.warehouseId, 10) : data.warehouseId;
    this.row = typeof data.row === "string" ? parseInt(data.row, 10) : data.row;
    this.col = typeof data.col === "string" ? parseInt(data.col, 10) : data.col;
    this.status = data.status || "active";
    this.locationType = data.locationType || "storage";
    if (data.locationCode !== undefined) this.locationCode = data.locationCode;
    if (data.capacity !== undefined) this.capacity = data.capacity;
    if (data.metadata !== undefined) this.metadata = data.metadata;
  }

  public build(): this {
    return this;
  }
}
