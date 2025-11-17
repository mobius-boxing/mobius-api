export class PaperTypeCreateInputDTO {
  code: string;
  description: string;

  constructor(data: any) {
    this.code = data.code;
    this.description = data.description;
  }

  public build(): this {
    return this;
  }
}
