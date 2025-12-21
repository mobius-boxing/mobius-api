export class WarehouseCreateInputDTO {
  name: string;
  gridRows: number;
  gridCols: number;
  companyId: number;

  constructor(data: any) {
    this.name = data.name;
    this.gridRows =
      typeof data.gridRows === "string"
        ? parseInt(data.gridRows, 10)
        : data.gridRows || 10;
    this.gridCols =
      typeof data.gridCols === "string"
        ? parseInt(data.gridCols, 10)
        : data.gridCols || 10;
    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : data.companyId;
  }

  public build(): this {
    return this;
  }
}
