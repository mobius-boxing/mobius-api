export class WarehouseUpdateInputDTO {
  name?: string;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
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
