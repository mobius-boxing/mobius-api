export class CorrugationClassCreateInputDTO {
  code: string;
  description?: string;

  constructor(data: any) {
    this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
  }

  public build(): this {
    return this;
  }
}
