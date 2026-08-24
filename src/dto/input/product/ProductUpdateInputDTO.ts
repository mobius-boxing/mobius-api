export class ProductUpdateInputDTO {
  code?: string;
  clientCode?: string;
  technicalSheetFileUuid?: string | null;
  blueprintFileUuid?: string | null;
  sketchFileUuid?: string | null;
  imageFileUuid?: string | null;
  description?: string;
  customerId?: number;
  revision?: number;
  vip?: boolean;
  productTypeId?: number | null;
  boxTypeId?: number | null;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.clientCode !== undefined) this.clientCode = data.clientCode;
    if (data.technicalSheetFileUuid !== undefined) this.technicalSheetFileUuid = data.technicalSheetFileUuid;
    if (data.blueprintFileUuid !== undefined) this.blueprintFileUuid = data.blueprintFileUuid;
    if (data.sketchFileUuid !== undefined) this.sketchFileUuid = data.sketchFileUuid;
    if (data.imageFileUuid !== undefined) this.imageFileUuid = data.imageFileUuid;
    if (data.description !== undefined) this.description = data.description;
    if (data.customerId !== undefined)
      this.customerId =
        typeof data.customerId === "string"
          ? parseInt(data.customerId, 10)
          : data.customerId;
    if (data.revision !== undefined)
      this.revision =
        typeof data.revision === "string"
          ? parseInt(data.revision, 10)
          : data.revision;
    if (data.vip !== undefined) this.vip = data.vip;
    if (data.productTypeId !== undefined)
      this.productTypeId =
        data.productTypeId === null
          ? null
          : typeof data.productTypeId === "string"
            ? parseInt(data.productTypeId, 10)
            : data.productTypeId;
    if (data.boxTypeId !== undefined)
      this.boxTypeId =
        data.boxTypeId === null
          ? null
          : typeof data.boxTypeId === "string"
            ? parseInt(data.boxTypeId, 10)
            : data.boxTypeId;
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
