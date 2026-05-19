export class ConsumableTypeCreateInputDTO {
  code: string;
  name: string;
  autoConsumption?: boolean;

  constructor(data: any) {
    this.code = data.code;
    this.name = data.name;
    if (data.autoConsumption !== undefined) this.autoConsumption = data.autoConsumption;
  }

  public build(): this {
    return this;
  }
}
