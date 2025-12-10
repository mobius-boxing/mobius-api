export class WarehouseCreateInputDTO {
  name: string;

  constructor(data: any) {
    this.name = data.name;
  }

  public build(): this {
    return this;
  }
}
