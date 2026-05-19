export class ConsumableTypeUpdateInputDTO {
  code?: string;
  name?: string;
  autoConsumption?: boolean;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
    if (data.autoConsumption !== undefined) this.autoConsumption = data.autoConsumption;
  }

  public build(): this {
    Object.keys(this).forEach(key => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
