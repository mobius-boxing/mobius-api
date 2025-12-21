export class PaperSheetUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string;
  supplierId?: number;
  manufacturerId?: number;
  corrugationId?: number;
  minimumStock?: number;
  length?: number;
  width?: number;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
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
    if (data.corrugationId !== undefined)
      this.corrugationId =
        typeof data.corrugationId === "string"
          ? parseInt(data.corrugationId, 10)
          : data.corrugationId;
    if (data.minimumStock !== undefined)
      this.minimumStock =
        typeof data.minimumStock === "string"
          ? parseInt(data.minimumStock, 10)
          : data.minimumStock;
    if (data.length !== undefined)
      this.length =
        typeof data.length === "string" ? parseFloat(data.length) : data.length;
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
