export class ProductCreateInputDTO {
  companyId: number;
  code: string;
  clientCode?: string;
  description?: string;
  customerId?: number;

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
  }

  public build(): this {
    return this;
  }
}
