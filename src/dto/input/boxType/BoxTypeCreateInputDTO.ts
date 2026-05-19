export class BoxTypeCreateInputDTO {
  code: string;
  name: string;

  constructor(data: any) {
    this.code = data.code;
    this.name = data.name;
  }

  public build(): this {
    return this;
  }
}
