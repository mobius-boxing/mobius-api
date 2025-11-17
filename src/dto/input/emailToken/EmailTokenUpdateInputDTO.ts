export class EmailTokenUpdateInputDTO {
  isUsed?: boolean;

  constructor(data: any) {
    if (data.isUsed !== undefined) this.isUsed = data.isUsed;
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
