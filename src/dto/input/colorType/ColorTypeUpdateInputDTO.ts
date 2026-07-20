export class ColorTypeUpdateInputDTO {
  name?: string;
  description?: string;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
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
