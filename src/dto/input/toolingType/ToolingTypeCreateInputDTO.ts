export class ToolingTypeCreateInputDTO {
  code: string;
  name: string;
  description?: string;
  automaticConsumption?: boolean;

  constructor(data: any) {
    this.code = data.code;
    this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.automaticConsumption !== undefined) this.automaticConsumption = data.automaticConsumption;
  }

  public build(): this {
    return this;
  }
}
