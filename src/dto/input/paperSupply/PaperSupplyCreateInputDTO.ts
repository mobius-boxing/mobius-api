export class PaperSupplyCreateInputDTO {
  companyId: number;
  code: string;
  description?: string;
  name?: string;
  manufacturerId?: number;
  supplierId?: number;
  paperTypeId?: number;
  grammage?: number;
  price?: number;
  color?: string;
  // Numeric by the time the DTO is built — the controller resolves the client's
  // uuid to a numeric id BEFORE constructing the DTO (same as manufacturerId).
  fscTypeId?: number;
  minimumStock?: { weightKg?: number | null; diameterMm?: number | null };

  constructor(data: any) {
    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : data.companyId;
    this.code = data.code;
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
    if (data.color !== undefined) this.color = data.color;
    if (data.fscTypeId !== undefined) this.fscTypeId = data.fscTypeId;
    if (data.minimumStock !== undefined) {
      // Corrected shape (§L.3): CantidadBobina — weight (kg) + diameter (mm).
      this.minimumStock = {
        weightKg:
          data.minimumStock.weightKg !== undefined && data.minimumStock.weightKg !== null
            ? Number(data.minimumStock.weightKg)
            : null,
        diameterMm:
          data.minimumStock.diameterMm !== undefined && data.minimumStock.diameterMm !== null
            ? Number(data.minimumStock.diameterMm)
            : null,
      };
    } else {
      this.minimumStock = { weightKg: null, diameterMm: null };
    }
  }

  public build(): this {
    return this;
  }
}
