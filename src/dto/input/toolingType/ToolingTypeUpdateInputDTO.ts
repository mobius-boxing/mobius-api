export class ToolingTypeUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string;
  automaticConsumption?: boolean;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.automaticConsumption !== undefined) this.automaticConsumption = data.automaticConsumption;
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
