export class ProductUpdateInputDTO {
  code?: string;
  clientCode?: string;
  description?: string;
  customerId?: number;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.clientCode !== undefined) this.clientCode = data.clientCode;
    if (data.description !== undefined) this.description = data.description;
    if (data.customerId !== undefined)
      this.customerId =
        typeof data.customerId === "string"
          ? parseInt(data.customerId, 10)
          : data.customerId;
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
