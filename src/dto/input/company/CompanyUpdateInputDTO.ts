export class CompanyUpdateInputDTO {
  name?: string;
  description?: string;
  isActive?: boolean;

  constructor(data: any) {
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.isActive !== undefined) this.isActive = data.isActive;
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
