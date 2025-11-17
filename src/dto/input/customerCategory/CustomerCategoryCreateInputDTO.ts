export class CustomerCategoryCreateInputDTO {
  name: string;
  companyId: number;

  constructor(data: any) {
    this.name = data.name;
    this.companyId =
      typeof data.companyId === "string"
        ? parseInt(data.companyId, 10)
        : data.companyId;
  }

  public build(): this {
    return this;
  }
}
