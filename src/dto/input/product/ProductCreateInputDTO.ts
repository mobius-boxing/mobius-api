export class ProductCreateInputDTO {
  companyId: number;
  code: string;
  clientCode?: string;
  description?: string;
  customerId?: number;
  revision?: number;
  vip?: boolean;
  productTypeId?: number;
  boxTypeId?: number;

  constructor(data: any) {
    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : data.companyId;
    this.code = data.code;
    if (data.clientCode !== undefined) this.clientCode = data.clientCode;
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
        typeof data.productTypeId === "string"
          ? parseInt(data.productTypeId, 10)
          : data.productTypeId;
    if (data.boxTypeId !== undefined)
      this.boxTypeId =
        typeof data.boxTypeId === "string"
          ? parseInt(data.boxTypeId, 10)
          : data.boxTypeId;
  }

  public build(): this {
    return this;
  }
}
