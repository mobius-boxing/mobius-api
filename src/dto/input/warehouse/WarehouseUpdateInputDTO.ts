export class WarehouseUpdateInputDTO {
  name?: string;
  gridRows?: number;
  gridCols?: number;
  companyId?: number;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.gridRows !== undefined) {
      this.gridRows = typeof data.gridRows === "string" ? parseInt(data.gridRows, 10) : data.gridRows;
    }
    if (data.gridCols !== undefined) {
      this.gridCols = typeof data.gridCols === "string" ? parseInt(data.gridCols, 10) : data.gridCols;
    }
    if (data.companyId !== undefined) {
      this.companyId = typeof data.companyId === "string" ? parseInt(data.companyId, 10) : data.companyId;
    }
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
