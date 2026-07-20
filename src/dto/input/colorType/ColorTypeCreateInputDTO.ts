export class ColorTypeCreateInputDTO {
  name: string;
  description?: string;

  constructor(data: any) {
    this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
  }

  public build(): this {
    return this;
  }
}
